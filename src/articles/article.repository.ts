import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';
import { Article } from './entities/article.entity';

export interface ArticlePageOptions {
  /** Case-insensitive match on name or description. */
  search?: string;
  skip: number;
  take: number;
}

@Injectable()
export class ArticleRepository {
  constructor(
    @InjectRepository(Article)
    private readonly articles: Repository<Article>,
  ) {}

  /**
   * The repository bound to the caller's transaction when there is one. Checkout
   * reserves stock and writes the order in a single transaction, and both have
   * to run through the same manager for the rollback to cover them.
   */
  private repository(manager?: EntityManager): Repository<Article> {
    return manager?.getRepository(Article) ?? this.articles;
  }

  findAll(): Promise<Article[]> {
    return this.articles.find({ order: { createdAt: 'DESC' } });
  }

  /** Returns the requested page together with the total match count. */
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
      // `id` breaks ties so two articles saved in the same millisecond cannot
      // swap places between page 1 and page 2.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  findById(id: string): Promise<Article | null> {
    return this.articles.findOne({ where: { id } });
  }

  findByIds(ids: string[], manager?: EntityManager): Promise<Article[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.repository(manager).find({ where: { id: In(ids) } });
  }

  /**
   * Takes `quantity` pieces off the shelf, or reports that there were not
   * enough. The check and the decrement are one statement on purpose: two
   * customers buying the last piece at the same moment cannot both win it, no
   * matter how many replicas of the shop are running. A read-then-write would
   * oversell.
   */
  async reserveStock(
    id: string,
    quantity: number,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repository(manager)
      .createQueryBuilder()
      .update(Article)
      .set({ quantity: () => 'quantity - :reserved' })
      .where('id = :id', { id })
      .andWhere('quantity >= :reserved')
      .setParameter('reserved', quantity)
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Puts reserved pieces back on the shelf when an order will not be paid.
   *
   * Unconditional, unlike reserving: adding stock back can never fail on a
   * bound. `false` means the row is gone, which happens when the admin deleted
   * the article while an order still held some of it.
   */
  async releaseStock(
    id: string,
    quantity: number,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result = await this.repository(manager)
      .createQueryBuilder()
      .update(Article)
      .set({ quantity: () => 'quantity + :released' })
      .where('id = :id', { id })
      .setParameter('released', quantity)
      .execute();

    return (result.affected ?? 0) > 0;
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
