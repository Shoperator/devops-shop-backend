import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Base of every list endpoint. A shop keeps accumulating articles and orders
 * for as long as it runs, so no endpoint may return an unbounded result set:
 * one runaway response would blow the memory limit of a Shop pod and take the
 * replica down with it.
 */
export class PaginationQueryDto {
  // Query strings are always text, so the value has to be coerced before the
  // @IsInt check can mean anything.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
