import { OrderItem } from '../entities/order-item';
import { Order, OrderStatus } from '../entities/order.entity';

/** Only the fields the admin needs to recognise a buyer, never the whole user. */
export class OrderBuyerDto {
  id: string;
  username: string;
  displayName: string;
}

export class OrderResponseDto {
  id: string;
  buyerId: string;
  /** Null when the buyer relation was not loaded for this query. */
  buyer: OrderBuyerDto | null;
  items: OrderItem[];
  total: number;
  currency: string;
  status: OrderStatus;
  walletAddress: string | null;
  transactionHash: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(order: Order): OrderResponseDto {
    return {
      id: order.id,
      buyerId: order.buyerId,
      // Mapped by hand rather than spread: the user entity carries the password
      // hash and it must never reach a response.
      buyer: order.buyer
        ? {
            id: order.buyer.id,
            username: order.buyer.username,
            displayName: order.buyer.displayName,
          }
        : null,
      items: order.items,
      total: order.total,
      currency: order.currency,
      status: order.status,
      walletAddress: order.walletAddress,
      transactionHash: order.transactionHash,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
