import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, FindOptionsWhere, Repository } from 'typeorm';
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

  findById(id: string): Promise<Order | null> {
    return this.orders.findOne({ where: { id }, relations: { buyer: true } });
  }

  create(data: DeepPartial<Order>): Order {
    return this.orders.create(data);
  }

  save(order: Order): Promise<Order> {
    return this.orders.save(order);
  }
}
