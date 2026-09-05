import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * The shop's Redis connection, for shops deployed with `database: redis`.
 *
 * One client for the whole application: ioredis multiplexes commands over a
 * single socket and reconnects on its own, so a pool would buy nothing.
 */
@Injectable()
export class RedisConnection implements OnModuleDestroy {
  private readonly logger = new Logger(RedisConnection.name);

  readonly client: Redis;

  constructor(config: ConfigService) {
    const password = config.get<string>('REDIS_PASSWORD');

    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(config.get<string>('REDIS_PORT', '6379')),
      // An empty value is what an unset secret key looks like, and ioredis
      // would send AUTH with it and be rejected.
      password: password ? password : undefined,
      db: Number(config.get<string>('REDIS_DB', '0')),
      // The shop is deployed alongside its database, which may still be
      // starting: keep retrying instead of failing the boot.
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
