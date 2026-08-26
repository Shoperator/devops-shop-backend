import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Registration only ever creates customers, so the shop owner's admin account
 * is provisioned from the environment ShopHub deploys the shop with. Runs on
 * every boot and is a no-op once the account exists.
 */
@Injectable()
export class AdminSeeder implements OnModuleInit {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    const username = this.config.get<string>('SHOP_ADMIN_USERNAME');
    const password = this.config.get<string>('SHOP_ADMIN_PASSWORD');

    if (!username || !password) {
      this.logger.warn(
        'SHOP_ADMIN_USERNAME/SHOP_ADMIN_PASSWORD are not set, no admin account was created',
      );
      return;
    }

    if (await this.usersService.findByUsername(username)) {
      this.logger.log(`Shop admin "${username}" already exists`);
      return;
    }

    await this.usersService.create(
      {
        username,
        displayName: this.config.get<string>(
          'SHOP_ADMIN_DISPLAY_NAME',
          username,
        ),
        password,
      },
      UserRole.ADMIN,
    );
    this.logger.log(`Created shop admin "${username}"`);
  }
}
