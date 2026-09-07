import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ARTICLE_REPOSITORY } from '../articles/article.repository';
import { Article } from '../articles/entities/article.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderDraft, ORDER_REPOSITORY } from './order.repository';
import { OrdersService } from './orders.service';

const BUYER_ID = 'c0000000-0000-4000-8000-000000000001';
const TEA_ID = 'a0000000-0000-4000-8000-000000000001';
const MUG_ID = 'a0000000-0000-4000-8000-000000000002';

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
    currency: 'USDT',
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
  };
  let articleRepository: {
    findByIds: jest.Mock;
  };

  beforeEach(async () => {
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
          }),
        }),
      ),
      failPayment: jest.fn(() =>
        Promise.resolve({ failed: true, order: orderFixture() }),
      ),
    };

    articleRepository = {
      findByIds: jest.fn().mockResolvedValue([articleFixture()]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: ORDER_REPOSITORY, useValue: orderRepository },
        { provide: ARTICLE_REPOSITORY, useValue: articleRepository },
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
        currency: 'USDT',
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
        currency: 'USDT',
      });
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
