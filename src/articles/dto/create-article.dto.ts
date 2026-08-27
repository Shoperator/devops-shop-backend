import {
  IsInt,
  IsNumber,
  IsOptional,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Fits `numeric(18, 2)` with room to spare and keeps typos out of the shop. */
const MAX_PRICE = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;

export class CreateArticleDto {
  @Length(1, 128)
  name: string;

  @IsOptional()
  @MaxLength(2048)
  description?: string | null;

  /**
   * The column is `numeric(18, 2)`, so a third decimal would be rounded away
   * silently. Rejecting it up front keeps the stored price the one the admin
   * typed.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity: number;
}
