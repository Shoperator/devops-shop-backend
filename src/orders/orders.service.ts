import { Injectable } from '@nestjs/common';
import { ArticleRepository } from '../articles/article.repository';
import { OrderRepository } from './order.repository';

/**
 * Orders placed by customers and listed by the shop admin. Behaviour is added
 * in the follow-up commits of this PR.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly articleRepository: ArticleRepository,
  ) {}
}
