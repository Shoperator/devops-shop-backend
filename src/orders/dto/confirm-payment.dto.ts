import { Matches } from 'class-validator';

/** A 32-byte transaction hash, as every EVM chain and wallet renders one. */
export const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export class ConfirmPaymentDto {
  /**
   * The transaction the customer's wallet sent. Only the hash is accepted —
   * the amount, the recipient and the outcome are read back from the chain,
   * so a request cannot describe a payment that did not happen.
   *
   * The shape is checked here so a malformed hash costs a validation error
   * rather than a round trip to the node.
   */
  @Matches(TRANSACTION_HASH_PATTERN, {
    message: 'transactionHash must be a 0x-prefixed 32-byte hash',
  })
  transactionHash: string;
}
