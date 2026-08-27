import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PageDto } from '../common/dto/page.dto';
import { ArticleRepository } from './article.repository';
import { ArticleQueryDto } from './dto/article-query.dto';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { Article } from './entities/article.entity';

/**
 * Article catalogue: browsing and searching for customers, management for the
 * shop admin.
 */
@Injectable()
export class ArticlesService {
  // Catalogue changes are the shop owner's audit trail, and the only trace left
  // once a pod is replaced, so every mutation is logged.
  private readonly logger = new Logger(ArticlesService.name);

  constructor(private readonly articleRepository: ArticleRepository) {}

  async list(query: ArticleQueryDto): Promise<PageDto<Article>> {
    const search = query.search?.trim();

    const [items, total] = await this.articleRepository.findPage({
      search: search ? search : undefined,
      skip: query.skip,
      take: query.limit,
    });

    return PageDto.of(items, total, query.page, query.limit);
  }

  async getById(id: string): Promise<Article> {
    const article = await this.articleRepository.findById(id);
    if (article === null) {
      throw new NotFoundException(`Article ${id} not found`);
    }
    return article;
  }

  async create(dto: CreateArticleDto): Promise<Article> {
    const article = this.articleRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      price: dto.price,
      quantity: dto.quantity,
    });

    const saved = await this.articleRepository.save(article);
    this.logger.log(
      `Article created: ${saved.id} "${saved.name}" (${saved.quantity} pcs @ ${saved.price})`,
    );
    return saved;
  }

  async update(id: string, dto: UpdateArticleDto): Promise<Article> {
    const article = await this.getById(id);

    // Assigned field by field on purpose: `Object.assign` would also copy the
    // keys the request never sent and wipe them.
    if (dto.name !== undefined) {
      article.name = dto.name;
    }
    if (dto.description !== undefined) {
      article.description = dto.description ?? null;
    }
    if (dto.price !== undefined) {
      article.price = dto.price;
    }
    if (dto.quantity !== undefined) {
      article.quantity = dto.quantity;
    }

    const saved = await this.articleRepository.save(article);
    this.logger.log(
      `Article updated: ${saved.id} "${saved.name}" (${saved.quantity} pcs @ ${saved.price})`,
    );
    return saved;
  }

  async remove(id: string): Promise<void> {
    // Safe to delete outright: an order stores its own copy of the article name
    // and price in `items`, so past orders keep reading the way they were paid.
    if (!(await this.articleRepository.deleteById(id))) {
      throw new NotFoundException(`Article ${id} not found`);
    }
    this.logger.log(`Article deleted: ${id}`);
  }
}
