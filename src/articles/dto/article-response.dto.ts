import { Article } from '../entities/article.entity';

export class ArticleResponseDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  createdAt: string;

  static fromEntity(article: Article): ArticleResponseDto {
    return {
      id: article.id,
      name: article.name,
      description: article.description,
      price: article.price,
      quantity: article.quantity,
      imageUrl: article.imageUrl,
      createdAt: article.createdAt.toISOString(),
    };
  }
}
