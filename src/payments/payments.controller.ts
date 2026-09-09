import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConfigDto } from './dto/payment-config.dto';
import {
  getChainId,
  getShopWalletAddress,
  SHOP_CURRENCY,
} from './payment.config';

@Controller('payment-config')
export class PaymentsController {
  constructor(private readonly config: ConfigService) {}

  /**
   * How payments get through to this shop.
   *
   * Unauthenticated on purpose: a payout address and a chain id are public facts
   * about a shop. Address is printed on every transaction that ever reaches the shop
   */
  @Get()
  get(): PaymentConfigDto {
    const walletAddress = getShopWalletAddress(this.config);
    return {
      walletAddress,
      chainId: getChainId(this.config),
      currency: SHOP_CURRENCY,
      enabled: walletAddress !== null,
    };
  }
}
