import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import {
  ArticlePageOptions,
  ArticleRepository,
  NewArticle,
} from './article.repository';
import { Article } from './entities/article.entity';

/** The catalogue in PostgreSQL, for shops deployed with `database: postgresql`. */
@Injectable()
export class TypeOrmArticleRepository implements ArticleRepository {
  constructor(
    @InjectRepository(Article)
    private readonly articles: Repository<Article>,
  ) {}

  findPage(options: ArticlePageOptions): Promise<[Article[], number]> {
    const { search, skip, take } = options;

    // An array of conditions is an OR in TypeORM.
    const where: FindOptionsWhere<Article>[] | undefined =
      search === undefined
        ? undefined
        : [
            { name: ILike(`%${search}%`) },
            { description: ILike(`%${search}%`) },
          ];

    return this.articles.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
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

  create(data: NewArticle): Article {
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
