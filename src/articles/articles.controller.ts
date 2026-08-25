import { Controller } from '@nestjs/common';
import { ArticlesService } from './articles.service';

/** Endpoints are added in the follow-up commits of this PR. */
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}
}
