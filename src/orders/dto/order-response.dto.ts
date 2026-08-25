import { Order, OrderStatus } from '../entities/order.entity';

export class OrderItemResponseDto {
  articleId: string;
  articleName: string;
  unitPrice: number;
  quantity: number;
}

export class OrderResponseDto {
  id: string;
  buyerId: string;
  items: OrderItemResponseDto[];
  total: number;
  currency: string;
  status: OrderStatus;
  walletAddress: string | null;
  transactionHash: string | null;
  createdAt: string;

  static fromEntity(order: Order): OrderResponseDto {
    return {
      id: order.id,
      buyerId: order.buyerId,
      items: order.items.map((item) => ({
        articleId: item.articleId,
        articleName: item.articleName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      total: order.total,
      currency: order.currency,
      status: order.status,
      walletAddress: order.walletAddress,
      transactionHash: order.transactionHash,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
