import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ArticleQueryDto extends PaginationQueryDto {
  /** Matched against the article name and description, case-insensitively. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;
}
