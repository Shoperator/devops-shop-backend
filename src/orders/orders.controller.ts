import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PageDto } from '../common/dto/page.dto';
import { UserRole } from '../users/entities/user.entity';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

/**
 * Orders are commercial data: nothing here is public, and a customer must not
 * be able to read another customer's order.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  async list(
    @Query() query: OrderQueryDto,
  ): Promise<PageDto<OrderResponseDto>> {
    const page = await this.ordersService.list(query);
    return PageDto.map(page, (order) => OrderResponseDto.fromEntity(order));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return OrderResponseDto.fromEntity(await this.ordersService.getById(id));
  }
}
