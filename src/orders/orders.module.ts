import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// The repositories come from the global DatabaseModule, which binds them to the
// store this shop was deployed with.
@Module({
  imports: [ArticlesModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
