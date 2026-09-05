import { Article } from './entities/article.entity';

/**
 * Injection token for the catalogue store.
 *
 * An interface does not exist at runtime, so it cannot be a Nest provider on
 * its own. The token is what `DatabaseModule` binds to the implementation the
 * shop was deployed with.
 */
export const ARTICLE_REPOSITORY = 'ARTICLE_REPOSITORY';

export interface ArticlePageOptions {
  /** Case-insensitive match on name or description. */
  search?: string;
  skip: number;
  take: number;
}

/** The fields a new article is created from; the store fills in the rest. */
export interface NewArticle {
  name: string;
  description: string | null;
  price: number;
  quantity: number;
}

export interface ArticleRepository {
  /** Returns the requested page together with the total match count. */
  findPage(options: ArticlePageOptions): Promise<[Article[], number]>;

  findById(id: string): Promise<Article | null>;

  /** Used at checkout to price a basket. Missing ids are simply absent. */
  findByIds(ids: string[]): Promise<Article[]>;

  /** Builds an unsaved article. The id and timestamps appear on save. */
  create(data: NewArticle): Article;

  save(article: Article): Promise<Article>;

  /** `false` when there was no such article to delete. */
  deleteById(id: string): Promise<boolean>;
}
