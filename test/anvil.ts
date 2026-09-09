import {
  GenericContainer,
  StartedTestContainer,
  Wait,
} from 'testcontainers';

/**
 * Anvil, Foundry's development chain, as a throwaway container.
 *
 * The payment path is the one part of this shop that cannot be proved with a
 * mock: whether a transfer really happened is a question only a chain can
 * answer, and the whole point of the verifier is that it does not take the
 * client's word for it. A real chain in a container is what makes the test
 * exercise that, at the cost of a container start.
 *
 * The image's entrypoint is `/bin/sh -c`, so the whole command is one string.
 */
const ANVIL_IMAGE = 'ghcr.io/foundry-rs/foundry:latest';
const ANVIL_PORT = 8545;
export const ANVIL_CHAIN_ID = 31337;

/**
 * Anvil's deterministic accounts, from the standard mnemonic
 * "test test test test test test test test test test test junk". They are
 * unlocked on the node, so a test can send from them without signing anything.
 */
export const ANVIL_ACCOUNTS = {
  /** Account #0 — stands in for the customer's wallet. */
  buyer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  /** Account #1 — stands in for the shop's payout address. */
  shop: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  /** Account #2 — somewhere that is not the shop. */
  stranger: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
} as const;

export interface StartedAnvil {
  container: StartedTestContainer;
  rpcUrl: string;
}

export async function startAnvil(): Promise<StartedAnvil> {
  const container = await new GenericContainer(ANVIL_IMAGE)
    .withCommand([`anvil --host 0.0.0.0 --chain-id ${ANVIL_CHAIN_ID}`])
    .withExposedPorts(ANVIL_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const rpcUrl = `http://${container.getHost()}:${container.getMappedPort(ANVIL_PORT)}`;
  return { container, rpcUrl };
}

interface RpcResponse<T> {
  result?: T;
  error?: { message: string };
}

/** A minimal JSON-RPC caller, for driving the chain from a test. */
export async function rpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  const body = (await response.json()) as RpcResponse<T>;
  if (body.error !== undefined) {
    throw new Error(`${method} failed: ${body.error.message}`);
  }
  return body.result as T;
}

/**
 * The same conversion the shop does, repeated here rather than imported.
 *
 * A test that scaled the amount with the code under test would agree with it
 * even when both were wrong; spelling it out means the wei figure the chain
 * sees is one the test asserts independently.
 */
export function ethToWei(amount: number): bigint {
  return (BigInt(Math.round(amount * 100)) * 10n ** 18n) / 100n;
}

/** Sends a plain value transfer and answers with its hash. */
export function payFromWallet(
  rpcUrl: string,
  options: { from?: string; to: string; wei: bigint },
): Promise<string> {
  const { from = ANVIL_ACCOUNTS.buyer, to, wei } = options;

  return rpc<string>(rpcUrl, 'eth_sendTransaction', [
    { from, to, value: `0x${wei.toString(16)}` },
  ]);
}

/**
 * Waits until the transaction is in a block.
 *
 * Anvil mines on receipt, but the send call returns a moment before the block
 * exists, and a test that raced that would fail now and then for no reason.
 */
export async function waitForMined(
  rpcUrl: string,
  hash: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const receipt = await rpc<{ status: string } | null>(
      rpcUrl,
      'eth_getTransactionReceipt',
      [hash],
    );
    if (receipt !== null) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Transaction ${hash} was never mined`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
