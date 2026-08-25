import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';

export class CreateArticleDto {
  @IsString()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsInt()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;
}
