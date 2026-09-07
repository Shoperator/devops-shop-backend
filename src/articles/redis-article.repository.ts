import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hashFields, KEYS, readDate, readNumber } from '../database/redis.keys';
import { RedisConnection } from '../database/redis.connection';
import {
  ArticlePageOptions,
  ArticleRepository,
  NewArticle,
} from './article.repository';
import { Article } from './entities/article.entity';

type ArticleHash = Record<string, string | undefined>;

function toArticle(id: string, hash: ArticleHash): Article {
  const article = new Article();
  article.id = id;
  article.name = hash.name ?? '';
  article.description = hash.description ?? null;
  article.price = readNumber(hash.price);
  article.quantity = readNumber(hash.quantity);
  article.createdAt = readDate(hash.createdAt);
  article.updatedAt = readDate(hash.updatedAt);
  return article;
}

function matches(article: Article, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    article.name.toLowerCase().includes(needle) ||
    (article.description ?? '').toLowerCase().includes(needle)
  );
}

/**
 * The catalogue in Redis, for shops deployed with `database: redis`.
 *
 * An article is a hash, and `articles` is a sorted set of ids scored by
 * creation time — which is what gives the listing the same "newest first" order
 * PostgreSQL produces.
 */
@Injectable()
export class RedisArticleRepository implements ArticleRepository {
  constructor(private readonly redis: RedisConnection) {}

  async findPage(options: ArticlePageOptions): Promise<[Article[], number]> {
    const { search, skip, take } = options;

    if (search === undefined) {
      const total = await this.redis.client.zcard(KEYS.articleIndex);
      const ids = await this.redis.client.zrevrange(
        KEYS.articleIndex,
        skip,
        skip + take - 1,
      );
      return [await this.load(ids), total];
    }

    const ids = await this.redis.client.zrevrange(KEYS.articleIndex, 0, -1);
    const found = (await this.load(ids)).filter((article) =>
      matches(article, search),
    );
    return [found.slice(skip, skip + take), found.length];
  }

  async findById(id: string): Promise<Article | null> {
    const hash = await this.redis.client.hgetall(KEYS.article(id));
    return Object.keys(hash).length === 0 ? null : toArticle(id, hash);
  }

  findByIds(ids: string[]): Promise<Article[]> {
    return this.load(ids);
  }

  create(data: NewArticle): Article {
    const article = new Article();
    article.name = data.name;
    article.description = data.description;
    article.price = data.price;
    article.quantity = data.quantity;
    return article;
  }

  async save(article: Article): Promise<Article> {
    const now = new Date();
    // A new article has no id yet
    const isNew = !article.id;
    if (isNew) {
      article.id = randomUUID();
      article.createdAt = now;
    }
    article.updatedAt = now;

    const fields = hashFields({
      name: article.name,
      description: article.description,
      price: article.price,
      quantity: article.quantity,
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
    });

    const write = this.redis.client
      .multi()
      .hset(KEYS.article(article.id), fields);
    if (isNew) {
      write.zadd(KEYS.articleIndex, article.createdAt.getTime(), article.id);
    }
    await write.exec();

    return article;
  }

  async deleteById(id: string): Promise<boolean> {
    const [removed] = (await this.redis.client
      .multi()
      .del(KEYS.article(id))
      .zrem(KEYS.articleIndex, id)
      .exec()) as [[Error | null, number], [Error | null, number]];

    return removed[1] > 0;
  }

  private async load(ids: string[]): Promise<Article[]> {
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.client.pipeline();
    for (const id of ids) {
      pipeline.hgetall(KEYS.article(id));
    }
    const results = await pipeline.exec();

    const articles: Article[] = [];
    results?.forEach(([error, hash], index) => {
      if (error !== null) {
        throw error;
      }
      const fields = hash as ArticleHash;
      if (Object.keys(fields).length > 0) {
        articles.push(toArticle(ids[index], fields));
      }
    });
    return articles;
  }
}
