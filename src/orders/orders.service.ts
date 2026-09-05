import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ARTICLE_REPOSITORY } from '../articles/article.repository';
import type { ArticleRepository } from '../articles/article.repository';
import { PageDto } from '../common/dto/page.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderItem } from './entities/order-item';
import { Order } from './entities/order.entity';
import { ORDER_REPOSITORY } from './order.repository';
import type { OrderRepository } from './order.repository';

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
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(ARTICLE_REPOSITORY)
    private readonly articleRepository: ArticleRepository,
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
   * The basket is priced here and committed by the store in one step: if the
   * second article has run out, the pieces already counted for the first one
   * were never taken off the shelf, and no half-order is left behind. Which
   * mechanism makes that true — a transaction or a script — is the store's
   * business.
   */
  async checkout(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    const articleIds = dto.items.map((item) => item.articleId);
    if (new Set(articleIds).size !== articleIds.length) {
      throw new BadRequestException(
        'An article may only appear once in an order',
      );
    }

    const articles = await this.articleRepository.findByIds(articleIds);
    const byId = new Map(articles.map((article) => [article.id, article]));

    const items: OrderItem[] = [];
    let total = 0;

    for (const line of dto.items) {
      const article = byId.get(line.articleId);
      if (article === undefined) {
        throw new NotFoundException(`Article ${line.articleId} not found`);
      }

      // The price is copied in, not referenced: the amount paid is what the
      // article cost at checkout, even if the price changes in the meantime.
      items.push({
        articleId: article.id,
        articleName: article.name,
        unitPrice: article.price,
        quantity: line.quantity,
      });
      total += article.price * line.quantity;
    }

    // Payment processing with a blockchain wallet is still to be implemented.
    // Until then an order is created unpaid: the stock is held for the customer
    // and the status says the money has not arrived yet. When the payment comes
    // back rejected, `markPaymentFailed` puts it back.
    const result = await this.orderRepository.placeOrder({
      buyerId,
      items,
      total: toMoney(total),
      currency: SHOP_CURRENCY,
    });

    if (!result.placed) {
      const line = items.find((item) => item.articleId === result.articleId);
      throw new ConflictException(
        `"${line?.articleName ?? result.articleId}" does not have ${line?.quantity ?? 0} piece(s) left`,
      );
    }

    const { order } = result;
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
    const result = await this.orderRepository.failPayment(id);

    if (!result.failed) {
      if (result.reason === 'not-found') {
        throw new NotFoundException(`Order ${id} not found`);
      }
      throw new ConflictException(
        `Order ${id} is no longer pending, so its stock was not released again`,
      );
    }

    this.logger.log(
      `Order failed, stock released: ${id} (${result.order.items.length} article(s))`,
    );
    return result.order;
  }
}
