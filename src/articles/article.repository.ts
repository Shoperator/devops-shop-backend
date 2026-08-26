import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, In, Repository } from 'typeorm';
import { Article } from './entities/article.entity';

@Injectable()
export class ArticleRepository {
  constructor(
    @InjectRepository(Article)
    private readonly articles: Repository<Article>,
  ) {}

  findAll(): Promise<Article[]> {
    return this.articles.find({ order: { createdAt: 'DESC' } });
  }

  findById(id: string): Promise<Article | null> {
    return this.articles.findOne({ where: { id } });
  }

  findByIds(ids: string[]): Promise<Article[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.articles.find({ where: { id: In(ids) } });
  }

  create(data: DeepPartial<Article>): Article {
    return this.articles.create(data);
  }

  save(article: Article): Promise<Article> {
    return this.articles.save(article);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.articles.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
