/**
 * A single line of an order. Stored inside the `orders.items` jsonb column so an
 * order keeps the article name and price as they were at purchase time, even if
 * the admin later renames or reprices the article.
 */
export class OrderItem {
  articleId: string;
  articleName: string;
  unitPrice: number;
  quantity: number;
}
