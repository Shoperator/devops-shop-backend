import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';

export interface OrderPageOptions {
  status?: OrderStatus;
  /** Set when a customer lists their own orders instead of the admin listing all. */
  buyerId?: string;
  skip: number;
  take: number;
}

@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /** The repository bound to the caller's transaction when there is one. */
  private repository(manager?: EntityManager): Repository<Order> {
    return manager?.getRepository(Order) ?? this.orders;
  }

  findAll(): Promise<Order[]> {
    return this.orders.find({ order: { createdAt: 'DESC' } });
  }

  /** Returns the requested page together with the total match count. */
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

  findByBuyerId(buyerId: string): Promise<Order[]> {
    return this.orders.find({
      where: { buyerId },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string, manager?: EntityManager): Promise<Order | null> {
    return this.repository(manager).findOne({
      where: { id },
      relations: { buyer: true },
    });
  }

  /**
   * Moves an order from one status to another, and reports whether this call
   * is the one that did it.
   *
   * The `from` status is part of the statement rather than something the caller
   * checked a moment ago: two payment results racing each other would otherwise
   * both see PENDING and both put the same pieces back on the shelf. Only the
   * winner gets `true`.
   */
  async transitionStatus(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repository(manager)
      .createQueryBuilder()
      .update(Order)
      .set({ status: to })
      .where('id = :id', { id })
      .andWhere('status = :from', { from })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  create(data: DeepPartial<Order>): Order {
    return this.orders.create(data);
  }

  save(order: Order, manager?: EntityManager): Promise<Order> {
    return this.repository(manager).save(order);
  }
}
