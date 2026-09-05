import { Module } from '@nestjs/common';
import { AdminSeeder } from './admin-seeder.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// The repository comes from the global DatabaseModule, which binds it to the
// store this shop was deployed with.
@Module({
  controllers: [UsersController],
  providers: [UsersService, AdminSeeder],
  exports: [UsersService],
})
export class UsersModule {}
