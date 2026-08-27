import { PartialType } from '@nestjs/mapped-types';
import { CreateArticleDto } from './create-article.dto';

/**
 * Every field is optional: the admin edits one thing at a time (a restock, a
 * price change) and an absent field means "leave it as it is". `null` on an
 * optional field clears it.
 */
export class UpdateArticleDto extends PartialType(CreateArticleDto) {}
