import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { Order } from './entities/order.entity';

@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  findAll(): Promise<Order[]> {
    return this.orders.find({ order: { createdAt: 'DESC' } });
  }

  findByBuyerId(buyerId: string): Promise<Order[]> {
    return this.orders.find({
      where: { buyerId },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.orders.findOne({ where: { id } });
  }

  create(data: DeepPartial<Order>): Order {
    return this.orders.create(data);
  }

  save(order: Order): Promise<Order> {
    return this.orders.save(order);
  }
}
