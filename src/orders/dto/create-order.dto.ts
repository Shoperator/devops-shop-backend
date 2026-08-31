import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One basket line. The name and price are not accepted from the client — the
 * shop takes them from its own catalogue, so a request cannot set its own price. */
export class CreateOrderItemDto {
  @IsUUID()
  articleId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
