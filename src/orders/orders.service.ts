import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ArticleRepository } from '../articles/article.repository';
import { PageDto } from '../common/dto/page.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderItem } from './entities/order-item';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderRepository } from './order.repository';

/** The crypto currency this shop prices and settles in. */
const SHOP_CURRENCY = 'USDT';

/** Money is stored as `numeric(18, 2)`; float addition drifts past that. */
function toMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Orders placed by customers and listed by the shop admin.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly articleRepository: ArticleRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Every order in the shop, newest first. Admin only. */
  async list(query: OrderQueryDto): Promise<PageDto<Order>> {
    const [items, total] = await this.orderRepository.findPage({
      status: query.status,
      skip: query.skip,
      take: query.limit,
    });

    return PageDto.of(items, total, query.page, query.limit);
  }

  /** The orders one customer placed. */
  async listForBuyer(
    buyerId: string,
    query: PaginationQueryDto,
  ): Promise<PageDto<Order>> {
    const [items, total] = await this.orderRepository.findPage({
      buyerId,
      skip: query.skip,
      take: query.limit,
    });

    return PageDto.of(items, total, query.page, query.limit);
  }

  async getById(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (order === null) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  /**
   * Turns a customer's basket into an order.
   *
   * Reserving the stock and writing the order share one transaction: if the
   * second article in a basket has run out, the pieces already taken off the
   * shelf for the first one go back, and no half-order is left behind.
   */
  async checkout(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    const articleIds = dto.items.map((item) => item.articleId);
    if (new Set(articleIds).size !== articleIds.length) {
      throw new BadRequestException(
        'An article may only appear once in an order',
      );
    }

    const order = await this.dataSource.transaction(async (manager) => {
      const articles = await this.articleRepository.findByIds(
        articleIds,
        manager,
      );
      const byId = new Map(articles.map((article) => [article.id, article]));

      const items: OrderItem[] = [];
      let total = 0;

      for (const line of dto.items) {
        const article = byId.get(line.articleId);
        if (article === undefined) {
          throw new NotFoundException(`Article ${line.articleId} not found`);
        }

        const reserved = await this.articleRepository.reserveStock(
          article.id,
          line.quantity,
          manager,
        );
        if (!reserved) {
          throw new ConflictException(
            `"${article.name}" does not have ${line.quantity} piece(s) left`,
          );
        }

        // The price is copied in, not referenced: amount payed is what the
        // article cost at checkout, even if price changes in meantime.
        items.push({
          articleId: article.id,
          articleName: article.name,
          unitPrice: article.price,
          quantity: line.quantity,
        });
        total += article.price * line.quantity;
      }

      // payment processing with blockchain wallet to be implemented
      // Until then an order is created unpaid: the stock is held for the
      // customer and the status says the money has not arrived yet. When the
      // payment comes back rejected, `markPaymentFailed` puts it back.
      return this.orderRepository.save(
        this.orderRepository.create({
          buyerId,
          items,
          total: toMoney(total),
          currency: SHOP_CURRENCY,
          status: OrderStatus.PENDING,
        }),
        manager,
      );
    });

    this.logger.log(
      `Order created: ${order.id} by ${buyerId} (${order.items.length} article(s), ${order.total} ${order.currency})`,
    );
    return order;
  }

  /**
   * Marks an order as failed and puts the pieces it was holding back on the
   * shelf.
   *
   * Checkout reserves the stock before the money has moved, so an order whose
   * payment never settles would otherwise hold those pieces forever and the
   * shop would slowly sell itself out to orders nobody paid for. This is what
   * the blockchain payment integration calls when a payment is rejected, times
   * out, or comes back short.
   *
   * Only a PENDING order can fail this way: a PAID one needs a refund rather
   * than a release, and one that is already FAILED or CANCELLED has had its
   * stock returned once already. Both cases raise a ConflictException, so a
   * payment result delivered twice cannot return the same pieces twice.
   */
  async markPaymentFailed(id: string): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.orderRepository.findById(id, manager);
      if (order === null) {
        throw new NotFoundException(`Order ${id} not found`);
      }

      const hasFailed = await this.orderRepository.transitionStatus(
        id,
        OrderStatus.PENDING,
        OrderStatus.FAILED,
        manager,
      );
      if (!hasFailed) {
        throw new ConflictException(
          `Order ${id} is no longer pending, so its stock was not released again`,
        );
      }

      // Reached only by the caller that won the status change, so the stock
      // goes back exactly once however many payment results arrive at once. It
      // shares the transaction with that change: if a release fails, the order
      // stays pending rather than ending up failed with its stock lost.
      await this.releaseStock(order, manager);

      this.logger.log(
        `Order failed, stock released: ${id} (${order.items.length} article(s))`,
      );

      // Re-read so the caller gets the new status and timestamp.
      return (await this.orderRepository.findById(id, manager)) ?? order;
    });
  }

  private async releaseStock(
    order: Order,
    manager: EntityManager,
  ): Promise<void> {
    for (const item of order.items) {
      const released = await this.articleRepository.releaseStock(
        item.articleId,
        item.quantity,
        manager,
      );

      if (!released) {
        // The admin deleted the article while this order was pending. There is
        // no shelf left to put the pieces back on, and that is not a reason to
        // keep the customer's order alive.
        this.logger.warn(
          `Order ${order.id}: could not return ${item.quantity} piece(s) of deleted article ${item.articleId}`,
        );
      }
    }
  }
}
