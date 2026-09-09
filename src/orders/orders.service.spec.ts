import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ARTICLE_REPOSITORY } from '../articles/article.repository';
import { PaymentVerifierService } from '../payments/payment-verifier.service';
import { Article } from '../articles/entities/article.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderDraft, ORDER_REPOSITORY } from './order.repository';
import { OrdersService } from './orders.service';

const BUYER_ID = 'c0000000-0000-4000-8000-000000000001';
const TEA_ID = 'a0000000-0000-4000-8000-000000000001';
const MUG_ID = 'a0000000-0000-4000-8000-000000000002';
/** What the operator passes through as WALLET_ADDRESS. Anvil's account #1. */
const SHOP_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function articleFixture(overrides: Partial<Article> = {}): Article {
  return {
    id: TEA_ID,
    name: 'Green tea',
    description: null,
    price: 12.5,
    quantity: 8,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 'b0000000-0000-4000-8000-000000000001',
    buyerId: BUYER_ID,
    buyer: undefined as unknown as Order['buyer'],
    items: [
      {
        articleId: TEA_ID,
        articleName: 'Green tea',
        unitPrice: 12.5,
        quantity: 2,
      },
    ],
    total: 25,
    currency: 'ETH',
    status: OrderStatus.PENDING,
    walletAddress: null,
    transactionHash: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Builds the query the way the ValidationPipe would hand it to the controller. */
function query(overrides: Partial<OrderQueryDto> = {}): OrderQueryDto {
  return Object.assign(new OrderQueryDto(), overrides);
}

/**
 * What the service is responsible for once the store owns atomicity: pricing a
 * basket, refusing one that cannot be priced, and turning the store's answer
 * into the right HTTP failure.
 *
 * That stock is reserved and released exactly once is a promise of the store
 * itself, and is covered against a real PostgreSQL and a real Redis in the
 * integration tests — a mock cannot tell you whether a transaction or a script
 * actually held.
 */
describe('OrdersService', () => {
  let ordersService: OrdersService;
  let orderRepository: {
    findPage: jest.Mock;
    findById: jest.Mock;
    placeOrder: jest.Mock;
    failPayment: jest.Mock;
    confirmPayment: jest.Mock;
  };
  let articleRepository: {
    findByIds: jest.Mock;
  };
  let verifier: { verify: jest.Mock };
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    env = { WALLET_ADDRESS: SHOP_WALLET };
    verifier = { verify: jest.fn().mockResolvedValue({ valid: true }) };

    orderRepository = {
      findPage: jest.fn().mockResolvedValue([[], 0]),
      findById: jest.fn(),
      // Answers with the order the draft describes, so the assertions below can
      // read back what the service priced.
      placeOrder: jest.fn((draft: OrderDraft) =>
        Promise.resolve({
          placed: true,
          order: orderFixture({
            buyerId: draft.buyerId,
            items: draft.items,
            total: draft.total,
            currency: draft.currency,
            walletAddress: draft.walletAddress,
          }),
        }),
      ),
      failPayment: jest.fn(() =>
        Promise.resolve({ failed: true, order: orderFixture() }),
      ),
      confirmPayment: jest.fn(),
    };

    articleRepository = {
      findByIds: jest.fn().mockResolvedValue([articleFixture()]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: ORDER_REPOSITORY, useValue: orderRepository },
        { provide: ARTICLE_REPOSITORY, useValue: articleRepository },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
        { provide: PaymentVerifierService, useValue: verifier },
      ],
    }).compile();

    ordersService = moduleRef.get(OrdersService);
  });

  describe('list', () => {
    it('translates the page number into a row offset', async () => {
      await ordersService.list(query({ page: 2, limit: 10 }));

      expect(orderRepository.findPage).toHaveBeenCalledWith({
        status: undefined,
        skip: 10,
        take: 10,
      });
    });

    it('passes the status filter through', async () => {
      await ordersService.list(query({ status: OrderStatus.PAID }));

      expect(orderRepository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.PAID }),
      );
    });

    it('reports the total and the number of pages', async () => {
      orderRepository.findPage.mockResolvedValue([[orderFixture()], 21]);

      const page = await ordersService.list(query({ page: 1, limit: 10 }));

      expect(page).toMatchObject({
        total: 21,
        page: 1,
        limit: 10,
        totalPages: 3,
      });
      expect(page.items).toHaveLength(1);
    });

    it('lists no orders at all rather than every order when there are none', async () => {
      const page = await ordersService.list(query());

      expect(page).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });
  });

  describe('listForBuyer', () => {
    it('never leaves the buyer filter off, whatever the paging is', async () => {
      await ordersService.listForBuyer(
        BUYER_ID,
        Object.assign(new PaginationQueryDto(), { page: 3, limit: 5 }),
      );

      expect(orderRepository.findPage).toHaveBeenCalledWith({
        buyerId: BUYER_ID,
        skip: 10,
        take: 5,
      });
    });
  });

  describe('getById', () => {
    it('returns the order', async () => {
      const stored = orderFixture();
      orderRepository.findById.mockResolvedValue(stored);

      await expect(ordersService.getById(stored.id)).resolves.toBe(stored);
    });

    it('throws when the order does not exist', async () => {
      orderRepository.findById.mockResolvedValue(null);

      await expect(ordersService.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('checkout', () => {
    it('creates the order for the signed-in buyer, unpaid for now', async () => {
      const order = await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(order).toMatchObject({
        buyerId: BUYER_ID,
        status: OrderStatus.PENDING,
        currency: 'ETH',
      });
    });

    it('copies the name and price out of the catalogue, not out of the request', async () => {
      await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(orderRepository.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            {
              articleId: TEA_ID,
              articleName: 'Green tea',
              unitPrice: 12.5,
              quantity: 2,
            },
          ],
        }),
      );
    });

    it('adds the lines up itself', async () => {
      articleRepository.findByIds.mockResolvedValue([
        articleFixture(),
        articleFixture({ id: MUG_ID, name: 'Mug', price: 4.2 }),
      ]);

      const order = await ordersService.checkout(BUYER_ID, {
        items: [
          { articleId: TEA_ID, quantity: 2 },
          { articleId: MUG_ID, quantity: 3 },
        ],
      });

      expect(order.total).toBe(37.6);
    });

    it('rounds the total to the two decimals the column stores', async () => {
      articleRepository.findByIds.mockResolvedValue([
        articleFixture({ price: 0.1 }),
      ]);

      const order = await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 3 }],
      });

      // 0.1 * 3 is 0.30000000000000004 in floating point.
      expect(order.total).toBe(0.3);
    });

    it('hands the store one priced basket to commit', async () => {
      await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      // One call, so reserving the stock and writing the order are one step
      // whichever store is underneath.
      expect(orderRepository.placeOrder).toHaveBeenCalledTimes(1);
      expect(orderRepository.placeOrder).toHaveBeenCalledWith({
        buyerId: BUYER_ID,
        items: expect.any(Array) as unknown[],
        total: 25,
        currency: 'ETH',
        walletAddress: SHOP_WALLET,
      });
    });

    it('copies the shop wallet onto the order, so a reconfigure cannot move it', async () => {
      const order = await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(order.walletAddress).toBe(SHOP_WALLET);
    });

    it('still sells when the shop has no wallet, leaving the order unpayable', async () => {
      // A missing WALLET_ADDRESS must not take the catalogue down with the
      // payment path; the order is simply created with nowhere to pay.
      env.WALLET_ADDRESS = undefined;

      const order = await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(order.walletAddress).toBeNull();
    });

    it('refuses an article that ran out', async () => {
      orderRepository.placeOrder.mockResolvedValue({
        placed: false,
        articleId: TEA_ID,
      });

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 99 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('names the article the customer cannot have', async () => {
      orderRepository.placeOrder.mockResolvedValue({
        placed: false,
        articleId: TEA_ID,
      });

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 99 }],
        }),
      ).rejects.toThrow('Green tea');
    });

    it('refuses an article the admin deleted while it sat in the basket', async () => {
      articleRepository.findByIds.mockResolvedValue([]);

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderRepository.placeOrder).not.toHaveBeenCalled();
    });

    it('refuses the same article twice in one basket', async () => {
      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [
            { articleId: TEA_ID, quantity: 1 },
            { articleId: TEA_ID, quantity: 1 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderRepository.placeOrder).not.toHaveBeenCalled();
    });
  });

  describe('confirmPayment', () => {
    const TX =
      '0x1111111111111111111111111111111111111111111111111111111111111111';

    beforeEach(() => {
      orderRepository.findById.mockResolvedValue(
        orderFixture({ walletAddress: SHOP_WALLET }),
      );
      orderRepository.confirmPayment.mockImplementation(
        (id: string, transactionHash: string) =>
          Promise.resolve({
            confirmed: true,
            order: orderFixture({
              id,
              status: OrderStatus.PAID,
              transactionHash,
            }),
          }),
      );
    });

    it('settles the order and records the transaction', async () => {
      const order = await ordersService.confirmPayment(
        orderFixture().id,
        BUYER_ID,
        TX,
      );

      expect(order).toMatchObject({
        status: OrderStatus.PAID,
        transactionHash: TX,
      });
    });

    it('verifies against the address stored on the order, not the current config', async () => {
      // The shop may have been reconfigured since checkout; the money was sent
      // to the address the customer was shown at the time.
      const oldWallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
      orderRepository.findById.mockResolvedValue(
        orderFixture({ walletAddress: oldWallet }),
      );

      await ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX);

      expect(verifier.verify).toHaveBeenCalledWith(TX, oldWallet, 25);
    });

    it("hides another customer's order behind the same answer as a missing one", async () => {
      // Answering 403 here would confirm the order exists, letting a customer
      // enumerate other people's orders by id.
      orderRepository.findById.mockResolvedValue(
        orderFixture({ buyerId: 'c0000000-0000-4000-8000-000000000009' }),
      );

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderRepository.confirmPayment).not.toHaveBeenCalled();
    });

    it('never reaches the store when the chain disagrees', async () => {
      verifier.verify.mockResolvedValue({
        valid: false,
        reason: 'insufficient-amount',
        detail: 'That transaction paid 1 wei, 25000000000000000000 wei was owed',
      });

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(orderRepository.confirmPayment).not.toHaveBeenCalled();
    });

    it('refuses an order that is already paid', async () => {
      orderRepository.findById.mockResolvedValue(
        orderFixture({ status: OrderStatus.PAID, walletAddress: SHOP_WALLET }),
      );

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('refuses an order placed while the shop had no wallet', async () => {
      orderRepository.findById.mockResolvedValue(
        orderFixture({ walletAddress: null }),
      );

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('refuses a transaction that already paid another order', async () => {
      // The store owns this: only it can claim the hash and settle the order in
      // one step, so only it can tell the loser of that race.
      orderRepository.confirmPayment.mockResolvedValue({
        confirmed: false,
        reason: 'hash-used',
      });

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when another request settled the order first', async () => {
      orderRepository.confirmPayment.mockResolvedValue({
        confirmed: false,
        reason: 'not-pending',
      });

      await expect(
        ordersService.confirmPayment(orderFixture().id, BUYER_ID, TX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('markPaymentFailed', () => {
    it('answers with the order the store failed', async () => {
      const failed = orderFixture({ status: OrderStatus.FAILED });
      orderRepository.failPayment.mockResolvedValue({
        failed: true,
        order: failed,
      });

      await expect(ordersService.markPaymentFailed(failed.id)).resolves.toBe(
        failed,
      );
    });

    it('throws when the order does not exist', async () => {
      orderRepository.failPayment.mockResolvedValue({
        failed: false,
        reason: 'not-found',
      });

      await expect(
        ordersService.markPaymentFailed('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an order that is no longer pending', async () => {
      // A paid order needs a refund rather than a release, and one that already
      // failed has had its stock returned once. Either way the store declines,
      // so a payment result delivered twice cannot return the same pieces twice.
      orderRepository.failPayment.mockResolvedValue({
        failed: false,
        reason: 'not-pending',
      });

      await expect(
        ordersService.markPaymentFailed(orderFixture().id),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
