import { Module } from '@nestjs/common';
import { ChainClient } from './chain.client';
import { PaymentVerifierService } from './payment-verifier.service';
import { PaymentsController } from './payments.controller';

/**
 * The chain side of the shop: what to pay, and whether a payment happened.
 *
 * ConfigModule is global, so nothing needs importing here. The verifier is
 * exported because OrdersModule owns the order and therefore owns the decision
 * to mark one paid; this module only answers whether the chain agrees.
 */
@Module({
  controllers: [PaymentsController],
  providers: [ChainClient, PaymentVerifierService],
  exports: [PaymentVerifierService],
})
export class PaymentsModule {}
