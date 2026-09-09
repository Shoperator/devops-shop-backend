/**
 * What the storefront needs in order to ask a wallet for a payment.
 *
 * Deliberately not the RPC URL. The backend verifies payments through its own
 * JSON-RPC endpoint — a Service name inside the cluster — while the customer's
 * wallet holds a connection of its own. Publishing the internal address would
 * be useless to the browser and would describe the cluster to anyone who asked.
 */
export class PaymentConfigDto {
  /**
   * The shop's payout address, for showing the customer where the money goes
   * before they have an order. The address actually paid comes from the order
   * itself, which is pinned at checkout time.
   */
  walletAddress: string | null;

  /** EIP-155 chain id; the wallet is asked to switch to this before signing. */
  chainId: number;

  /** The native currency orders are priced in. */
  currency: string;

  /** False when the shop has no wallet configured and cannot take payment. */
  enabled: boolean;
}
