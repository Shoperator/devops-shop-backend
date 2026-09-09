import { ConfigService } from '@nestjs/config';

/**
 * The crypto currency this shop prices and settles in.
 *
 * Native currency rather than a token: payment is a plain value transfer to the
 * shop's address, which needs no contract deployed and no ERC-20 decoding to
 * verify. On Anvil and on every EVM testnet that unit is called ETH.
 */
export const SHOP_CURRENCY = 'ETH';

/** Wei per whole unit of the native currency: EVM chains use 18 decimals. */
export const WEI_PER_ETHER = 10n ** 18n;

/**
 * Anvil's chain id. A shop deployed without chain settings is a shop pointed at
 * the local development chain, which is what `npm run start:dev` and the
 * integration tests run against.
 */
export const DEFAULT_CHAIN_ID = 31337;

/** Anvil's default listen address, for local development. */
export const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';

/**
 * How far behind the head a transaction has to be before it is treated as
 * settled.
 *
 * Zero on purpose. Anvil mines a block per transaction and then stops, so
 * nothing produces the blocks a higher number would wait for and every payment
 * would hang. On a public testnet, where a reorg can un-mine a block, raise this
 * to one or two through `PAYMENT_CONFIRMATIONS`.
 */
export const DEFAULT_CONFIRMATIONS = 0;

/**
 * The address customers pay this shop at.
 *
 * The operator passes the Shop resource's `spec.walletAddress` through as
 * `WALLET_ADDRESS`. Missing is a legitimate state rather than a fatal one: a
 * shop with no wallet still lists its catalogue and its orders, it just cannot
 * take payment, and refusing to boot would take the whole storefront down with
 * the payment path.
 */
export function getShopWalletAddress(config: ConfigService): string | null {
  const address = config.get<string>('WALLET_ADDRESS')?.trim();
  return address === undefined || address === '' ? null : address;
}

/**
 * The chain the shop settles on, as EIP-155 numbers it. The browser needs this
 * to ask the wallet to switch networks before it signs anything.
 */
export function getChainId(config: ConfigService): number {
  return readPositiveInt(config.get<string>('CHAIN_ID'), DEFAULT_CHAIN_ID);
}

/**
 * The JSON-RPC endpoint the *backend* verifies payments through. In the cluster
 * this is a Service name, so it is deliberately never handed to the browser:
 * the customer's wallet holds its own connection to the chain.
 */
export function getRpcUrl(config: ConfigService): string {
  const url = config.get<string>('RPC_URL')?.trim();
  return url === undefined || url === '' ? DEFAULT_RPC_URL : url;
}

/**
 * How long to wait for a submitted transaction to make it into a block.
 *
 * A wallet returns the hash the moment it broadcasts, so a payment is normally
 * submitted to the shop a fraction of a second before it is mined. Anvil closes
 * that gap in about twenty milliseconds; a public testnet takes a block time,
 * so raise this to a block or two through `PAYMENT_MINED_TIMEOUT_MS` there.
 *
 * Bounded because the wait happens inside the customer's HTTP request. Running
 * out is not a rejection: the storefront offers to check the same hash again.
 */
export const DEFAULT_MINED_TIMEOUT_MS = 5_000;

export function getMinedTimeoutMs(config: ConfigService): number {
  const raw = config.get<string>('PAYMENT_MINED_TIMEOUT_MS');
  const parsed = Number(raw);
  return raw === undefined || !Number.isInteger(parsed) || parsed < 0
    ? DEFAULT_MINED_TIMEOUT_MS
    : parsed;
}

export function getRequiredConfirmations(config: ConfigService): number {
  const raw = config.get<string>('PAYMENT_CONFIRMATIONS');
  const parsed = Number(raw);
  return raw === undefined || !Number.isInteger(parsed) || parsed < 0
    ? DEFAULT_CONFIRMATIONS
    : parsed;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw === undefined || !Number.isInteger(parsed) || parsed <= 0
    ? fallback
    : parsed;
}
