import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OrderStatus } from '../entities/order.entity';

export class OrderQueryDto extends PaginationQueryDto {
  /** Lets the admin narrow the list down to e.g. the orders still unpaid. */
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
