import { Controller } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** Endpoints are added in the follow-up commits of this PR. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}
}
