import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisConnection } from '../database/redis.connection';
import { hashFields, KEYS, readDate } from '../database/redis.keys';
import { User, UserRole } from './entities/user.entity';
import { NewUser, UserRepository, UsernameTakenError } from './user.repository';

type UserHash = Record<string, string | undefined>;

function toUser(id: string, hash: UserHash): User {
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
 * Users in Redis, for shops deployed with `database: redis`.
 *
 * Usernames have to be unique, and Redis has no unique index — so the username
 * key doubles as the claim: `SET … NX` succeeds for exactly one of two
 * registrations racing each other, and the loser gets the same
 * UsernameTakenError PostgreSQL's unique index produces.
 */
@Injectable()
export class RedisUserRepository implements UserRepository {
  constructor(private readonly redis: RedisConnection) {}

  async findById(id: string): Promise<User | null> {
    const hash = await this.redis.client.hgetall(KEYS.user(id));
    return Object.keys(hash).length === 0 ? null : toUser(id, hash);
  }

  async findByUsername(username: string): Promise<User | null> {
    const id = await this.redis.client.get(KEYS.usernameIndex(username));
    return id === null ? null : this.findById(id);
  }

  async existsByUsername(username: string): Promise<boolean> {
    return (await this.redis.client.exists(KEYS.usernameIndex(username))) > 0;
  }

  create(data: NewUser): User {
    const user = new User();
    user.username = data.username;
    user.displayName = data.displayName;
    user.passwordHash = data.passwordHash;
    user.walletAddress = data.walletAddress;
    user.role = data.role;
    return user;
  }

  async save(user: User): Promise<User> {
    const now = new Date();
    const isNew = !user.id;

    if (isNew) {
      user.id = randomUUID();
      user.createdAt = now;

      // Claim the username before writing the user: if another registration got
      // there first this fails, and no half-registered account is left behind.
      const claimed = await this.redis.client.set(
        KEYS.usernameIndex(user.username),
        user.id,
        'NX',
      );
      if (claimed === null) {
        throw new UsernameTakenError(user.username);
      }
    }
    user.updatedAt = now;

    await this.redis.client.hset(
      KEYS.user(user.id),
      hashFields({
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: user.role,
        walletAddress: user.walletAddress,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }),
    );

    return user;
  }
}
