import { Injectable } from '@nestjs/common';
import { ArticleRepository } from './article.repository';

/**
 * Article catalogue: browsing and searching for customers, management for the
 * shop admin. Behaviour is added in the follow-up commits of this PR.
 */
@Injectable()
export class ArticlesService {
  constructor(private readonly articleRepository: ArticleRepository) {}
}
