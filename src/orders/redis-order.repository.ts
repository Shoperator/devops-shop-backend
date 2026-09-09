import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisConnection } from '../database/redis.connection';
import {
  ARTICLE_KEY_PREFIX,
  hashFields,
  KEYS,
  readDate,
  readNumber,
} from '../database/redis.keys';
import { SHOP_CURRENCY } from '../payments/payment.config';
import { User, UserRole } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item';
import { Order, OrderStatus } from './entities/order.entity';
import {
  ConfirmPaymentResult,
  FailPaymentResult,
  OrderDraft,
  OrderPageOptions,
  OrderRepository,
  PlaceOrderResult,
} from './order.repository';

type Hash = Record<string, string | undefined>;

/**
 * Reserves every line and writes the order, or changes nothing.
 *
 * A Lua script is Redis's transaction: the server runs it to completion without
 * interleaving another client's commands, so the check-and-decrement of every
 * article and the write of the order are one atomic step — the same guarantee
 * PostgreSQL gives through `BEGIN`/`COMMIT`.
 *
 * KEYS  1..n  the article of each line, then the order, the order index and
 *             the buyer's order index
 * ARGV  1     how many lines there are
 *       2..   the quantity of each line, then the index score, the order id,
 *             and the order's hash fields as flat field/value pairs
 *
 * Returns 0 when the order was placed, the 1-based line number that had too
 * little stock, or its negative when that article no longer exists.
 */
const PLACE_ORDER = `
local lines = tonumber(ARGV[1])

for i = 1, lines do
  local available = redis.call('HGET', KEYS[i], 'quantity')
  if not available then
    return -i
  end
  if tonumber(available) < tonumber(ARGV[1 + i]) then
    return i
  end
end

for i = 1, lines do
  redis.call('HINCRBY', KEYS[i], 'quantity', -tonumber(ARGV[1 + i]))
end

local fields = {}
for i = lines + 4, #ARGV do
  fields[#fields + 1] = ARGV[i]
end

redis.call('HSET', KEYS[lines + 1], unpack(fields))
redis.call('ZADD', KEYS[lines + 2], tonumber(ARGV[lines + 2]), ARGV[lines + 3])
redis.call('ZADD', KEYS[lines + 3], tonumber(ARGV[lines + 2]), ARGV[lines + 3])
return 0
`;

/**
 * Moves a PENDING order to FAILED and returns its stock, or changes nothing.
 *
 * The status check and the release are in the same script, so two payment
 * results arriving together cannot both return the same pieces: the second one
 * finds a status that is no longer PENDING and stops.
 *
 * KEYS  1   the order
 * ARGV  1   the status the order must be in
 *       2   the status to move it to
 *       3   the new updatedAt
 *       4   the prefix article keys are built from
 *
 * The article keys are derived inside the script rather than passed in KEYS,
 * because which articles they are is only known once the order has been read.
 * That is safe on the single Redis instance a shop is given, and would need
 * revisiting only under Redis Cluster, where a script may not touch keys
 * outside its declared slots.
 *
 * Returns 0 when the order failed, -1 when there is no such order, and -2 when
 * it was not pending.
 */
const FAIL_PAYMENT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then
  return -1
end
if status ~= ARGV[1] then
  return -2
end

redis.call('HSET', KEYS[1], 'status', ARGV[2], 'updatedAt', ARGV[3])

local raw = redis.call('HGET', KEYS[1], 'items')
if raw then
  for _, item in ipairs(cjson.decode(raw)) do
    local article = ARGV[4] .. item.articleId
    if redis.call('EXISTS', article) == 1 then
      redis.call('HINCRBY', article, 'quantity', item.quantity)
    end
  end
end
return 0
`;

/**
 * Moves a PENDING order to PAID and records the transaction, or changes nothing.
 *
 * Redis has no unique index, so the "one transfer settles one order" guarantee
 * is a claim key taken inside the same script: `SET ... NX` succeeds for
 * exactly one caller. Doing it here rather than as a separate command is what
 * makes it hold across replicas — a claim taken and then abandoned by a failed
 * status check would block the hash forever, which is why the status is checked
 * first.
 *
 * KEYS  1   the order
 *       2   the claim key for this transaction hash
 * ARGV  1   the status the order must be in
 *       2   the status to move it to
 *       3   the transaction hash
 *       4   the new updatedAt
 *
 * Returns 0 when the order was paid, -1 when there is no such order, -2 when it
 * was not pending, and -3 when the hash already settled a different order.
 */
const CONFIRM_PAYMENT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then
  return -1
end
if status ~= ARGV[1] then
  return -2
end

local claimed = redis.call('SET', KEYS[2], KEYS[1], 'NX')
if not claimed then
  if redis.call('GET', KEYS[2]) ~= KEYS[1] then
    return -3
  end
end

redis.call('HSET', KEYS[1],
  'status', ARGV[2],
  'transactionHash', ARGV[3],
  'updatedAt', ARGV[4])
return 0
`;

function toOrder(id: string, hash: Hash): Order {
  const order = new Order();
  order.id = id;
  order.buyerId = hash.buyerId ?? '';
  order.buyer = undefined as unknown as User;
  order.items =
    hash.items === undefined ? [] : (JSON.parse(hash.items) as OrderItem[]);
  order.total = readNumber(hash.total);
  order.currency = hash.currency ?? SHOP_CURRENCY;
  order.status =
    (hash.status as OrderStatus | undefined) ?? OrderStatus.PENDING;
  order.walletAddress = hash.walletAddress ?? null;
  order.transactionHash = hash.transactionHash ?? null;
  order.createdAt = readDate(hash.createdAt);
  order.updatedAt = readDate(hash.updatedAt);
  return order;
}

function toBuyer(id: string, hash: Hash): User {
  const user = new User();
  user.id = id;
  user.username = hash.username ?? '';
  user.displayName = hash.displayName ?? '';
  user.passwordHash = hash.passwordHash ?? '';
  user.role = (hash.role as UserRole | undefined) ?? UserRole.CUSTOMER;
  user.walletAddress = hash.walletAddress ?? null;
  user.createdAt = readDate(hash.createdAt);
  user.updatedAt = readDate(hash.updatedAt);
  return user;
}

/**
 * Orders in Redis, for shops deployed with `database: redis`.
 *
 * An order is a hash with its lines as JSON, indexed by creation time in a
 * sorted set — one for the whole shop and one per customer, which is what makes
 * "my orders" a range read rather than a scan.
 */
@Injectable()
export class RedisOrderRepository implements OrderRepository {
  constructor(private readonly redis: RedisConnection) {}

  /**
   * The buyer index answers a customer's own listing directly. Filtering by
   * status has no index behind it, so those listings read the range and filter
   * here — the same trade-off the catalogue search makes.
   */
  async findPage(options: OrderPageOptions): Promise<[Order[], number]> {
    const { status, buyerId, skip, take } = options;
    const index =
      buyerId === undefined ? KEYS.orderIndex : KEYS.buyerOrderIndex(buyerId);

    if (status === undefined) {
      const total = await this.redis.client.zcard(index);
      const ids = await this.redis.client.zrevrange(
        index,
        skip,
        skip + take - 1,
      );
      return [await this.hydrate(await this.load(ids)), total];
    }

    const ids = await this.redis.client.zrevrange(index, 0, -1);
    const found = (await this.load(ids)).filter(
      (order) => order.status === status,
    );
    return [await this.hydrate(found.slice(skip, skip + take)), found.length];
  }

  async findById(id: string): Promise<Order | null> {
    const hash = await this.redis.client.hgetall(KEYS.order(id));
    if (Object.keys(hash).length === 0) {
      return null;
    }
    const [order] = await this.hydrate([toOrder(id, hash)]);
    return order;
  }

  async placeOrder(draft: OrderDraft): Promise<PlaceOrderResult> {
    const id = randomUUID();
    const now = new Date();

    const keys = [
      ...draft.items.map((item) => KEYS.article(item.articleId)),
      KEYS.order(id),
      KEYS.orderIndex,
      KEYS.buyerOrderIndex(draft.buyerId),
    ];

    const argv = [
      String(draft.items.length),
      ...draft.items.map((item) => String(item.quantity)),
      String(now.getTime()),
      id,
      // `hashFields` drops a null wallet address rather than writing the string
      // "null", and `toOrder` reads an absent field back as null.
      ...hashFields({
        buyerId: draft.buyerId,
        items: JSON.stringify(draft.items),
        total: draft.total,
        currency: draft.currency,
        status: OrderStatus.PENDING,
        walletAddress: draft.walletAddress,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    ];

    const outcome = (await this.redis.client.eval(
      PLACE_ORDER,
      keys.length,
      ...keys,
      ...argv,
    )) as number;

    if (outcome !== 0) {
      // Positive is "not enough left", negative is "no such article"; either
      // way it is the line at that position that stopped the order.
      const line = draft.items[Math.abs(outcome) - 1];
      return { placed: false, articleId: line.articleId };
    }

    const order = new Order();
    order.id = id;
    order.buyerId = draft.buyerId;
    order.buyer = undefined as unknown as User;
    order.items = draft.items;
    order.total = draft.total;
    order.currency = draft.currency;
    order.status = OrderStatus.PENDING;
    order.walletAddress = draft.walletAddress;
    order.transactionHash = null;
    order.createdAt = now;
    order.updatedAt = now;
    return { placed: true, order };
  }

  async failPayment(id: string): Promise<FailPaymentResult> {
    const result = (await this.redis.client.eval(
      FAIL_PAYMENT,
      1,
      KEYS.order(id),
      OrderStatus.PENDING,
      OrderStatus.FAILED,
      new Date().toISOString(),
      ARTICLE_KEY_PREFIX,
    )) as number;

    if (result === -1) {
      return { failed: false, reason: 'not-found' };
    }
    if (result === -2) {
      return { failed: false, reason: 'not-pending' };
    }

    const order = await this.findById(id);
    return order === null
      ? { failed: false, reason: 'not-found' }
      : { failed: true, order };
  }

  async confirmPayment(
    id: string,
    transactionHash: string,
  ): Promise<ConfirmPaymentResult> {
    const outcome = (await this.redis.client.eval(
      CONFIRM_PAYMENT,
      2,
      KEYS.order(id),
      KEYS.paymentClaim(transactionHash),
      OrderStatus.PENDING,
      OrderStatus.PAID,
      transactionHash,
      new Date().toISOString(),
    )) as number;

    if (outcome === -1) {
      return { confirmed: false, reason: 'not-found' };
    }
    if (outcome === -2) {
      return { confirmed: false, reason: 'not-pending' };
    }
    if (outcome === -3) {
      return { confirmed: false, reason: 'hash-used' };
    }

    const order = await this.findById(id);
    return order === null
      ? { confirmed: false, reason: 'not-found' }
      : { confirmed: true, order };
  }

  /** Reads several orders in one round trip, skipping any that are gone. */
  private async load(ids: string[]): Promise<Order[]> {
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.client.pipeline();
    for (const id of ids) {
      pipeline.hgetall(KEYS.order(id));
    }
    const results = await pipeline.exec();

    const orders: Order[] = [];
    results?.forEach(([error, hash], index) => {
      if (error !== null) {
        throw error;
      }
      const fields = hash as Hash;
      if (Object.keys(fields).length > 0) {
        orders.push(toOrder(ids[index], fields));
      }
    });
    return orders;
  }

  /**
   * Attaches the buyer to each order, the way the relation is joined in on the
   * PostgreSQL side — the admin listing shows who ordered. Each buyer is read
   * once however many orders they placed on the page.
   */
  private async hydrate(orders: Order[]): Promise<Order[]> {
    const buyerIds = [...new Set(orders.map((order) => order.buyerId))];
    if (buyerIds.length === 0) {
      return orders;
    }

    const pipeline = this.redis.client.pipeline();
    for (const buyerId of buyerIds) {
      pipeline.hgetall(KEYS.user(buyerId));
    }
    const results = await pipeline.exec();

    const buyers = new Map<string, User>();
    results?.forEach(([error, hash], index) => {
      if (error !== null) {
        throw error;
      }
      const fields = hash as Hash;
      if (Object.keys(fields).length > 0) {
        buyers.set(buyerIds[index], toBuyer(buyerIds[index], fields));
      }
    });

    for (const order of orders) {
      order.buyer = buyers.get(order.buyerId) as User;
    }
    return orders;
  }
}
