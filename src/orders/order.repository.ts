import { OrderItem } from './entities/order-item';
import { Order, OrderStatus } from './entities/order.entity';

/** Injection token for the order store. See {@link ArticleRepository}. */
export const ORDER_REPOSITORY = 'ORDER_REPOSITORY';

export interface OrderPageOptions {
  status?: OrderStatus;
  /** Set when a customer lists their own orders instead of the admin listing all. */
  buyerId?: string;
  skip: number;
  take: number;
}

/**
 * A priced basket, ready to become an order. The service has already looked the
 * articles up and copied their name and price into the items, so the store only
 * has to deal with quantities.
 */
export interface OrderDraft {
  buyerId: string;
  items: OrderItem[];
  total: number;
  currency: string;
}

export type PlaceOrderResult =
  | { placed: true; order: Order }
  /** The article that could not be reserved; nothing was taken off any shelf. */
  | { placed: false; articleId: string };

export type FailPaymentResult =
  | { failed: true; order: Order }
  | { failed: false; reason: 'not-found' | 'not-pending' };

/**
 * Orders, and the two operations that have to be all-or-nothing.
 *
 * `placeOrder` and `failPayment` are on the store rather than composed in the
 * service on purpose. Both span several keys — every article in the basket plus
 * the order itself — and the only component that can make a multi-key change
 * atomic is the store that holds them. Expressing them as one call each lets
 * PostgreSQL use a transaction and Redis use a single script, and keeps the
 * guarantee identical either way instead of leaving the service to undo half a
 * checkout by hand.
 *
 * Pricing and validation stay in the service: the store is told what to write,
 * never what an order is worth.
 */
export interface OrderRepository {
  /** Returns the requested page together with the total match count. */
  findPage(options: OrderPageOptions): Promise<[Order[], number]>;

  findById(id: string): Promise<Order | null>;

  /**
   * Reserves every line's stock and writes the order, or does neither.
   *
   * Reserving is a check and a decrement in one step, so two customers buying
   * the last piece at the same moment cannot both win it, however many replicas
   * of the shop are running.
   */
  placeOrder(draft: OrderDraft): Promise<PlaceOrderResult>;

  /**
   * Moves a PENDING order to FAILED and puts the pieces it was holding back on
   * the shelf, as one step.
   *
   * Checkout reserves stock before the money has moved, so an order whose
   * payment never settles would otherwise hold those pieces forever. Only the
   * caller that wins the status change releases the stock, so a payment result
   * delivered twice cannot return the same pieces twice. An article the admin
   * deleted meanwhile is skipped — there is no shelf left to put it back on.
   */
  failPayment(id: string): Promise<FailPaymentResult>;
}
