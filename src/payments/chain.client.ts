import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRpcUrl } from './payment.config';

/** The fields of a transaction this shop cares about, as JSON-RPC returns them. */
export interface ChainTransaction {
  /** Recipient. Null for a contract creation, which is never a payment. */
  to: string | null;
  from: string;
  /** Value in wei, hex-encoded. */
  value: string;
  /** Null while the transaction is still in the mempool. */
  blockNumber: string | null;
}

export interface ChainReceipt {
  /** `0x1` succeeded, `0x0` reverted. */
  status: string;
  blockNumber: string;
}

/** Raised when the node is unreachable or answers with an error object. */
export class ChainUnavailableError extends Error {}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

/**
 * A JSON-RPC client, kept to the three calls verifying a payment needs.
 *
 * Hand-rolled rather than pulled from ethers or viem: the shop only ever reads
 * three fields off two objects and never signs anything, so a dependency that
 * carries a whole wallet implementation would be paying for a signing stack the
 * backend must not have. Every private key in this system belongs to a customer
 * or to a Secret the operator wrote — none of them to this process.
 */
@Injectable()
export class ChainClient {
  private readonly logger = new Logger(ChainClient.name);

  constructor(private readonly config: ConfigService) {}

  getTransaction(hash: string): Promise<ChainTransaction | null> {
    return this.call<ChainTransaction | null>('eth_getTransactionByHash', [
      hash,
    ]);
  }

  getReceipt(hash: string): Promise<ChainReceipt | null> {
    return this.call<ChainReceipt | null>('eth_getTransactionReceipt', [hash]);
  }

  async getBlockNumber(): Promise<bigint> {
    return BigInt(await this.call<string>('eth_blockNumber', []));
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const url = getRpcUrl(this.config);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        // A node that hangs must not hold an HTTP request open indefinitely;
        // the customer gets "try again" rather than a stuck spinner.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`${method} could not reach ${url}: ${detail}`);
      throw new ChainUnavailableError(`Chain node is unreachable: ${detail}`);
    }

    if (!response.ok) {
      throw new ChainUnavailableError(
        `Chain node answered ${response.status} to ${method}`,
      );
    }

    const body = (await response.json()) as RpcResponse<T>;
    if (body.error !== undefined) {
      throw new ChainUnavailableError(
        `Chain node rejected ${method}: ${body.error.message}`,
      );
    }
    return body.result as T;
  }
}
