/**
 * Every key the Redis stores use, in one place.
 *
 * A shop gets a Redis database to itself, so the names only have to be unique
 * within the shop and can stay readable — `redis-cli KEYS 'article:*'` is a
 * legitimate way to look at a shop's catalogue while debugging.
 */
export const KEYS = {
  article: (id: string) => `article:${id}`,
  /** Article ids scored by creation time, newest last. */
  articleIndex: 'articles',

  user: (id: string) => `user:${id}`,
  /** Username to id, and the claim that makes usernames unique. */
  usernameIndex: (username: string) => `users:by-username:${username}`,

  order: (id: string) => `order:${id}`,
  /** Order ids scored by creation time, newest last. */
  orderIndex: 'orders',
  /** The same, restricted to one customer. */
  buyerOrderIndex: (buyerId: string) => `orders:buyer:${buyerId}`,
} as const;

/** Prefix the Lua scripts rebuild article keys from. */
export const ARTICLE_KEY_PREFIX = 'article:';

/**
 * Redis hashes hold strings, and a field that was never set comes back
 * undefined. These translate between that and the entity's types.
 */
export function readNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

export function readDate(value: string | undefined): Date {
  return value === undefined ? new Date(0) : new Date(value);
}

/**
 * Drops the fields that have no value, because `HSET` cannot write `undefined`
 * and a null column is simply an absent field here.
 */
export function hashFields(
  values: Record<string, string | number | null | undefined>,
): string[] {
  const fields: string[] = [];
  for (const [field, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      fields.push(field, String(value));
    }
  }
  return fields;
}
