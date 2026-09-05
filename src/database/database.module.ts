import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ARTICLE_REPOSITORY } from '../articles/article.repository';
import { Article } from '../articles/entities/article.entity';
import { RedisArticleRepository } from '../articles/redis-article.repository';
import { TypeOrmArticleRepository } from '../articles/typeorm-article.repository';
import { Order } from '../orders/entities/order.entity';
import { ORDER_REPOSITORY } from '../orders/order.repository';
import { RedisOrderRepository } from '../orders/redis-order.repository';
import { TypeOrmOrderRepository } from '../orders/typeorm-order.repository';
import { User } from '../users/entities/user.entity';
import { RedisUserRepository } from '../users/redis-user.repository';
import { TypeOrmUserRepository } from '../users/typeorm-user.repository';
import { USER_REPOSITORY } from '../users/user.repository';
import { RedisConnection } from './redis.connection';

/**
 * Which database this shop was deployed with.
 *
 * ShopHub calls these `standard` and `light`; the Shop custom resource carries
 * them as `postgresql` and `redis`, and the operator passes that straight
 * through as `DB_KIND`.
 */
export type StoreKind = 'postgres' | 'redis';

export function resolveStoreKind(value: string | undefined): StoreKind {
  return value?.trim().toLowerCase() === 'redis' ? 'redis' : 'postgres';
}

/**
 * Binds the repository ports to the store this shop runs on.
 *
 * Global, so that a domain module asks for `ARTICLE_REPOSITORY` and never has
 * to know which of the two answered. Nothing outside this file imports both
 * implementations.
 *
 * The choice is read from `process.env` rather than through ConfigService,
 * because it decides which modules exist — and that has to be settled before
 * Nest builds the injector, while ConfigService only exists afterwards.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    return resolveStoreKind(process.env.DB_KIND) === 'redis'
      ? DatabaseModule.redis()
      : DatabaseModule.postgres();
  }

  private static postgres(): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            type: 'postgres' as const,
            host: config.get<string>('DB_HOST', 'localhost'),
            port: Number(config.get<string>('DB_PORT', '5432')),
            username: config.get<string>('DB_USERNAME', 'shop'),
            password: config.get<string>('DB_PASSWORD', 'shop'),
            database: config.get<string>('DB_NAME', 'shop'),
            autoLoadEntities: true,
            // The shop database is provisioned per deployment by the CNPG
            // operator, so the schema is created from the entities instead of
            // migrations.
            synchronize:
              config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
          }),
        }),
        TypeOrmModule.forFeature([Article, Order, User]),
      ],
      providers: [
        { provide: ARTICLE_REPOSITORY, useClass: TypeOrmArticleRepository },
        { provide: ORDER_REPOSITORY, useClass: TypeOrmOrderRepository },
        { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
      ],
      exports: [ARTICLE_REPOSITORY, ORDER_REPOSITORY, USER_REPOSITORY],
    };
  }

  private static redis(): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        RedisConnection,
        { provide: ARTICLE_REPOSITORY, useClass: RedisArticleRepository },
        { provide: ORDER_REPOSITORY, useClass: RedisOrderRepository },
        { provide: USER_REPOSITORY, useClass: RedisUserRepository },
      ],
      exports: [ARTICLE_REPOSITORY, ORDER_REPOSITORY, USER_REPOSITORY],
    };
  }
}
