import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChainClient, ChainReceipt } from './chain.client';
import {
  getMinedTimeoutMs,
  getRequiredConfirmations,
  WEI_PER_ETHER,
} from './payment.config';

/** How often the receipt is asked for while waiting for the block. */
const RECEIPT_POLL_INTERVAL_MS = 250;

/**
 * Why a payment was not accepted. Each value is a distinct thing that went
 * wrong on chain, so the customer can be told which — "you paid the wrong
 * address" and "your transaction has not been mined yet" want very different
 * reactions.
 */
export type PaymentRejection =
  | 'unknown-transaction'
  | 'not-mined'
  | 'reverted'
  | 'wrong-recipient'
  | 'insufficient-amount'
  | 'too-few-confirmations';

export type VerificationResult =
  | { valid: true }
  | { valid: false; reason: PaymentRejection; detail: string };

/**
 * Converts an order total into wei.
 *
 * `total` is `numeric(18, 2)`, so multiplying by 100 lands exactly on an
 * integer number of cents; the rest of the scaling happens in BigInt. Doing it
 * as `total * 1e18` in floating point would silently pay the wrong amount —
 * 12.5 ETH is representable, 0.1 + 0.2 ETH is not.
 */
export function toWei(total: number): bigint {
  return (BigInt(Math.round(total * 100)) * WEI_PER_ETHER) / 100n;
}

/** Addresses are compared as lowercase hex: EIP-55 casing is display only. */
function sameAddress(a: string | null, b: string | null): boolean {
  return (
    a !== null && b !== null && a.toLowerCase().trim() === b.toLowerCase().trim()
  );
}

/**
 * Decides whether a transaction really paid an order.
 *
 * Nothing here trusts the browser beyond the hash itself: the amount, the
 * recipient and the outcome are all read back from the chain. Without that, a
 * customer could pay once and submit the same hash against every basket they
 * own.
 */
@Injectable()
export class PaymentVerifierService {
  private readonly logger = new Logger(PaymentVerifierService.name);

  constructor(
    private readonly chain: ChainClient,
    private readonly config: ConfigService,
  ) {}

  async verify(
    transactionHash: string,
    expectedRecipient: string,
    expectedTotal: number,
  ): Promise<VerificationResult> {
    const transaction = await this.chain.getTransaction(transactionHash);
    if (transaction === null) {
      return reject(
        'unknown-transaction',
        'The chain does not know that transaction',
      );
    }

    // The wallet hands the browser a hash the moment it broadcasts, which is
    // before the transaction is in a block, so checking once would reject a
    // perfectly good payment for arriving too fast. Anvil closes that window in
    // about twenty milliseconds; a public testnet takes a block time.
    const receipt = await this.waitForReceipt(transactionHash);
    if (receipt === null) {
      return reject(
        'not-mined',
        'That transaction has not been included in a block yet. It should confirm shortly — check again in a moment.',
      );
    }

    // Being in a block is not the same as having succeeded.
    if (BigInt(receipt.status) !== 1n) {
      return reject('reverted', 'That transaction failed on chain');
    }

    if (!sameAddress(transaction.to, expectedRecipient)) {
      return reject(
        'wrong-recipient',
        `That transaction paid ${transaction.to ?? 'a new contract'}, not this shop`,
      );
    }

    const paid = BigInt(transaction.value);
    const owed = toWei(expectedTotal);
    if (paid < owed) {
      return reject(
        'insufficient-amount',
        `That transaction paid ${paid} wei, ${owed} wei was owed`,
      );
    }

    const required = getRequiredConfirmations(this.config);
    if (required > 0) {
      const head = await this.chain.getBlockNumber();
      // The receipt's block, not the transaction's: by this point the receipt
      // exists, and its block number is never null.
      const confirmations = head - BigInt(receipt.blockNumber) + 1n;
      if (confirmations < BigInt(required)) {
        return reject(
          'too-few-confirmations',
          `That transaction has ${confirmations} of ${required} confirmations`,
        );
      }
    }

    this.logger.log(
      `Payment verified: ${transactionHash} paid ${paid} wei to ${expectedRecipient}`,
    );
    return { valid: true };
  }

  /**
   * Waits for the transaction to make it into a block, up to a bounded time.
   *
   * Bounded rather than open-ended because this runs inside the customer's HTTP
   * request: a chain that has stopped producing blocks must end in an answer
   * they can act on, not a request that never returns. Giving up is not the
   * same as rejecting the payment — the caller reports `not-mined`, and the
   * storefront offers to check the same hash again rather than pay twice.
   */
  private async waitForReceipt(hash: string): Promise<ChainReceipt | null> {
    const deadline = Date.now() + getMinedTimeoutMs(this.config);

    for (;;) {
      const receipt = await this.chain.getReceipt(hash);
      if (receipt !== null) {
        return receipt;
      }
      if (Date.now() + RECEIPT_POLL_INTERVAL_MS > deadline) {
        return null;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RECEIPT_POLL_INTERVAL_MS),
      );
    }
  }
}

function reject(reason: PaymentRejection, detail: string): VerificationResult {
  return { valid: false, reason, detail };
}
