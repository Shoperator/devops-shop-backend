import { Article } from '../entities/article.entity';

export class ArticleResponseDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  /** Derived here so the storefront does not have to know the stock rule. */
  inStock: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(article: Article): ArticleResponseDto {
    return {
      id: article.id,
      name: article.name,
      description: article.description,
      price: article.price,
      quantity: article.quantity,
      inStock: article.quantity > 0,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }
}
