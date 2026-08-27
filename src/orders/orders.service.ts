import { Injectable, NotFoundException } from '@nestjs/common';
import { ArticleRepository } from '../articles/article.repository';
import { PageDto } from '../common/dto/page.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order } from './entities/order.entity';
import { OrderRepository } from './order.repository';

/**
 * Orders placed by customers and listed by the shop admin. Checkout itself
 * (cart, on-chain payment) arrives with the customer purchase ticket.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
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

  async getById(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (order === null) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }
}
