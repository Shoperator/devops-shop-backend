import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
// Type-only: `emitDecoratorMetadata` would otherwise emit a runtime reference
// to an interface that does not exist at runtime.
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { PageDto } from '../common/dto/page.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserRole } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
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

  /** Checkout. The basket lives in the customer's browser until this call. */
  @Post()
  @Roles(UserRole.CUSTOMER)
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return OrderResponseDto.fromEntity(
      await this.ordersService.checkout(user.id, dto),
    );
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async list(
    @Query() query: OrderQueryDto,
  ): Promise<PageDto<OrderResponseDto>> {
    const page = await this.ordersService.list(query);
    return PageDto.map(page, (order) => OrderResponseDto.fromEntity(order));
  }

  // Declared before `:id`, which would otherwise swallow the path.
  @Get('mine')
  @Roles(UserRole.CUSTOMER)
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<OrderResponseDto>> {
    const page = await this.ordersService.listForBuyer(user.id, query);
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
