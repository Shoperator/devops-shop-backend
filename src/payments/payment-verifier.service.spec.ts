import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ChainClient } from './chain.client';
import { PaymentVerifierService, toWei } from './payment-verifier.service';

/** Anvil account #1, the shop. Deliberately in EIP-55 mixed case. */
const SHOP = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SOMEONE_ELSE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TX = '0x1111111111111111111111111111111111111111111111111111111111111111';

describe('toWei', () => {
  it('scales a whole amount exactly', () => {
    expect(toWei(25)).toBe(25_000_000_000_000_000_000n);
  });

  it('scales an amount with cents exactly', () => {
    expect(toWei(12.5)).toBe(12_500_000_000_000_000_000n);
  });

  it('does not drift on a total floating point cannot represent', () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a double. The column stores 0.30,
    // and the customer must be asked for exactly that.
    expect(toWei(0.3)).toBe(300_000_000_000_000_000n);
  });

  it('keeps a single cent worth 10^16 wei', () => {
    expect(toWei(0.01)).toBe(10_000_000_000_000_000n);
  });
});

describe('PaymentVerifierService', () => {
  let verifier: PaymentVerifierService;
  let chain: {
    getTransaction: jest.Mock;
    getReceipt: jest.Mock;
    getBlockNumber: jest.Mock;
  };
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    env = {};
    chain = {
      // 25 ETH to the shop, mined in block 7.
      getTransaction: jest.fn().mockResolvedValue({
        to: SHOP,
        from: SOMEONE_ELSE,
        value: '0x15af1d78b58c40000',
        blockNumber: '0x7',
      }),
      getReceipt: jest
        .fn()
        .mockResolvedValue({ status: '0x1', blockNumber: '0x7' }),
      getBlockNumber: jest.fn().mockResolvedValue(7n),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentVerifierService,
        { provide: ChainClient, useValue: chain },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    verifier = moduleRef.get(PaymentVerifierService);
  });

  it('accepts a transfer of exactly what was owed', async () => {
    await expect(verifier.verify(TX, SHOP, 25)).resolves.toEqual({
      valid: true,
    });
  });

  it('accepts an overpayment', async () => {
    await expect(verifier.verify(TX, SHOP, 20)).resolves.toEqual({
      valid: true,
    });
  });

  it('compares addresses without regard to EIP-55 casing', async () => {
    await expect(
      verifier.verify(TX, SHOP.toLowerCase(), 25),
    ).resolves.toEqual({ valid: true });
  });

  it('rejects a transaction the chain has never seen', async () => {
    chain.getTransaction.mockResolvedValue(null);

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'unknown-transaction',
    });
  });

  it('waits for a transaction that has been broadcast but not yet mined', async () => {
    // A wallet returns the hash before the transaction is in a block, so the
    // shop must not reject a good payment for arriving a moment too early.
    chain.getReceipt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ status: '0x1', blockNumber: '0x7' });

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toEqual({
      valid: true,
    });
    expect(chain.getReceipt).toHaveBeenCalledTimes(3);
  });

  it('gives up on a transaction that never gets mined, without rejecting it', async () => {
    // `not-mined` means "ask again", not "you did not pay": the storefront
    // offers to re-check the same hash rather than pay a second time.
    env.PAYMENT_MINED_TIMEOUT_MS = '0';
    chain.getReceipt.mockResolvedValue(null);

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'not-mined',
    });
  });

  it('rejects a mined transaction that reverted', async () => {
    // Being in a block is not the same as having succeeded.
    chain.getReceipt.mockResolvedValue({ status: '0x0', blockNumber: '0x7' });

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'reverted',
    });
  });

  it('rejects a transfer that paid somebody else', async () => {
    await expect(
      verifier.verify(TX, SOMEONE_ELSE, 25),
    ).resolves.toMatchObject({ valid: false, reason: 'wrong-recipient' });
  });

  it('rejects a contract creation, which pays nobody', async () => {
    chain.getTransaction.mockResolvedValue({
      to: null,
      from: SOMEONE_ELSE,
      value: '0x15af1d78b58c40000',
      blockNumber: '0x7',
    });

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'wrong-recipient',
    });
  });

  it('rejects a transfer one wei short', async () => {
    // The boundary is the whole point: >= passes, < does not.
    chain.getTransaction.mockResolvedValue({
      to: SHOP,
      from: SOMEONE_ELSE,
      value: '0x' + (toWei(25) - 1n).toString(16),
      blockNumber: '0x7',
    });

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'insufficient-amount',
    });
  });

  it('does not ask for the head block when no confirmations are required', async () => {
    // Anvil mines on demand and then stops, so waiting for depth would hang.
    await verifier.verify(TX, SHOP, 25);

    expect(chain.getBlockNumber).not.toHaveBeenCalled();
  });

  it('rejects a transaction too close to the head when depth is required', async () => {
    env.PAYMENT_CONFIRMATIONS = '3';
    chain.getBlockNumber.mockResolvedValue(8n);

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toMatchObject({
      valid: false,
      reason: 'too-few-confirmations',
    });
  });

  it('accepts one buried deep enough', async () => {
    env.PAYMENT_CONFIRMATIONS = '3';
    chain.getBlockNumber.mockResolvedValue(9n);

    await expect(verifier.verify(TX, SHOP, 25)).resolves.toEqual({
      valid: true,
    });
  });
});
