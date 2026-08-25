import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USERNAME', 'shop'),
        password: config.get<string>('DB_PASSWORD', 'shop'),
        database: config.get<string>('DB_NAME', 'shop'),
        autoLoadEntities: true,
        // The shop database is provisioned per deployment by the CNPG operator,
        // so the schema is created from the entities instead of migrations.
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
      }),
    }),
  ],
})
export class DatabaseModule {}
