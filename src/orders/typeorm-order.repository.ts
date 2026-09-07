import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { Article } from '../articles/entities/article.entity';
import { Order, OrderStatus } from './entities/order.entity';
import {
  FailPaymentResult,
  OrderDraft,
  OrderPageOptions,
  OrderRepository,
  PlaceOrderResult,
} from './order.repository';

/**
 * Thrown to roll the checkout transaction back when a line has run out.
 *
 * A rejected line is not an error the caller sees — `placeOrder` reports it in
 * its result — but throwing is the only way to abandon a TypeORM transaction,
 * so it is caught again immediately outside.
 */
class OutOfStockError extends Error {
  constructor(readonly articleId: string) {
    super(`Article ${articleId} is out of stock`);
  }
}

/** Orders in PostgreSQL, for shops deployed with `database: postgresql`. */
@Injectable()
export class TypeOrmOrderRepository implements OrderRepository {
  private readonly logger = new Logger(TypeOrmOrderRepository.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  findPage(options: OrderPageOptions): Promise<[Order[], number]> {
    const { status, buyerId, skip, take } = options;

    const where: FindOptionsWhere<Order> = {};
    if (status !== undefined) {
      where.status = status;
    }
    if (buyerId !== undefined) {
      where.buyerId = buyerId;
    }

    return this.orders.findAndCount({
      where,
      // The admin listing shows who ordered, so the buyer is joined in rather
      // than fetched one query per row.
      relations: { buyer: true },
      // `id` breaks ties so pages stay stable for orders sharing a timestamp.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.orders.findOne({ where: { id }, relations: { buyer: true } });
  }

  /**
   * One transaction covers every reservation and the order itself, so if the
   * second article in a basket has run out, the pieces already taken off the
   * shelf for the first one go back and no half-order is left behind.
   */
  async placeOrder(draft: OrderDraft): Promise<PlaceOrderResult> {
    try {
      const order = await this.dataSource.transaction(async (manager) => {
        for (const item of draft.items) {
          const reserved = await this.reserveStock(
            manager,
            item.articleId,
            item.quantity,
          );
          if (!reserved) {
            throw new OutOfStockError(item.articleId);
          }
        }

        const orders = manager.getRepository(Order);
        return orders.save(
          orders.create({
            buyerId: draft.buyerId,
            items: draft.items,
            total: draft.total,
            currency: draft.currency,
            status: OrderStatus.PENDING,
          }),
        );
      });

      return { placed: true, order };
    } catch (error) {
      if (error instanceof OutOfStockError) {
        return { placed: false, articleId: error.articleId };
      }
      throw error;
    }
  }

  async failPayment(id: string): Promise<FailPaymentResult> {
    return this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(Order);
      const order = await orders.findOne({ where: { id } });
      if (order === null) {
        return { failed: false, reason: 'not-found' };
      }

      // The expected status is part of the statement rather than something
      // checked a moment ago: two payment results racing each other would
      // otherwise both see PENDING and both put the same pieces back.
      const result = await orders
        .createQueryBuilder()
        .update(Order)
        .set({ status: OrderStatus.FAILED })
        .where('id = :id', { id })
        .andWhere('status = :from', { from: OrderStatus.PENDING })
        .execute();

      if ((result.affected ?? 0) === 0) {
        return { failed: false, reason: 'not-pending' };
      }

      // Reached only by the caller that won the status change, and inside the
      // same transaction: if a release fails, the order stays pending rather
      // than ending up failed with its stock lost.
      for (const item of order.items) {
        const released = await this.releaseStock(
          manager,
          item.articleId,
          item.quantity,
        );
        if (!released) {
          this.logger.warn(
            `Order ${id}: could not return ${item.quantity} piece(s) of deleted article ${item.articleId}`,
          );
        }
      }

      // Re-read so the caller gets the new status and timestamp.
      const failed = await orders.findOne({
        where: { id },
        relations: { buyer: true },
      });
      return failed === null
        ? { failed: false, reason: 'not-found' }
        : { failed: true, order: failed };
    });
  }

  /**
   * Takes pieces off the shelf, or reports that there were not enough. The
   * check and the decrement are one statement on purpose: a read-then-write
   * would oversell.
   */
  private async reserveStock(
    manager: EntityManager,
    id: string,
    quantity: number,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Article)
      .set({ quantity: () => 'quantity - :reserved' })
      .where('id = :id', { id })
      .andWhere('quantity >= :reserved')
      .setParameter('reserved', quantity)
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Puts reserved pieces back. Unconditional, unlike reserving: adding stock
   * back can never fail on a bound. `false` means the row is gone, which
   * happens when the admin deleted the article while an order still held some.
   */
  private async releaseStock(
    manager: EntityManager,
    id: string,
    quantity: number,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Article)
      .set({ quantity: () => 'quantity + :released' })
      .where('id = :id', { id })
      .setParameter('released', quantity)
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
