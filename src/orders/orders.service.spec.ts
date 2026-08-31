import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { ArticleRepository } from '../articles/article.repository';
import { Article } from '../articles/entities/article.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderRepository } from './order.repository';
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

describe('OrdersService', () => {
  let ordersService: OrdersService;
  let orderRepository: {
    findPage: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    transitionStatus: jest.Mock;
  };
  let articleRepository: {
    findByIds: jest.Mock;
    reserveStock: jest.Mock;
    releaseStock: jest.Mock;
  };
  let transactionManager: EntityManager;

  beforeEach(async () => {
    transactionManager = {} as EntityManager;

    orderRepository = {
      findPage: jest.fn().mockResolvedValue([[], 0]),
      findById: jest.fn(),
      create: jest.fn((data: Partial<Order>) => data as Order),
      save: jest.fn((order: Order) => Promise.resolve(order)),
      transitionStatus: jest.fn().mockResolvedValue(true),
    };

    articleRepository = {
      findByIds: jest.fn().mockResolvedValue([articleFixture()]),
      reserveStock: jest.fn().mockResolvedValue(true),
      releaseStock: jest.fn().mockResolvedValue(true),
    };

    const dataSource = {
      transaction: jest.fn(
        (runInTransaction: (manager: EntityManager) => Promise<unknown>) =>
          runInTransaction(transactionManager),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrderRepository, useValue: orderRepository },
        { provide: ArticleRepository, useValue: articleRepository },
        { provide: getDataSourceToken(), useValue: dataSource },
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
      const order = await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(order.items).toEqual([
        {
          articleId: TEA_ID,
          articleName: 'Green tea',
          unitPrice: 12.5,
          quantity: 2,
        },
      ]);
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

    it('takes the pieces off the shelf', async () => {
      await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      expect(articleRepository.reserveStock).toHaveBeenCalledWith(
        TEA_ID,
        2,
        transactionManager,
      );
    });

    it('reserves the stock and saves the order in one transaction', async () => {
      await ordersService.checkout(BUYER_ID, {
        items: [{ articleId: TEA_ID, quantity: 2 }],
      });

      // Both writes go through the same manager, so a failure rolls back both.
      expect(articleRepository.reserveStock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        transactionManager,
      );
      expect(orderRepository.save).toHaveBeenCalledWith(
        expect.anything(),
        transactionManager,
      );
    });

    it('refuses an article that ran out, without writing an order', async () => {
      articleRepository.reserveStock.mockResolvedValue(false);

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 99 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orderRepository.save).not.toHaveBeenCalled();
    });

    it('names the article the customer cannot have', async () => {
      articleRepository.reserveStock.mockResolvedValue(false);

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 99 }],
        }),
      ).rejects.toThrow('Green tea');
    });

    it('gives up when one line of the basket is out of stock', async () => {
      articleRepository.findByIds.mockResolvedValue([
        articleFixture(),
        articleFixture({ id: MUG_ID, name: 'Mug' }),
      ]);
      // The tea is reserved, the mug is not: the transaction has to undo the tea.
      articleRepository.reserveStock
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [
            { articleId: TEA_ID, quantity: 1 },
            { articleId: MUG_ID, quantity: 1 },
          ],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orderRepository.save).not.toHaveBeenCalled();
    });

    it('refuses an article the admin deleted while it sat in the basket', async () => {
      articleRepository.findByIds.mockResolvedValue([]);

      await expect(
        ordersService.checkout(BUYER_ID, {
          items: [{ articleId: TEA_ID, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(articleRepository.reserveStock).not.toHaveBeenCalled();
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
      expect(articleRepository.reserveStock).not.toHaveBeenCalled();
    });
  });

  describe('markPaymentFailed', () => {
    const pendingOrder = orderFixture();

    beforeEach(() => {
      orderRepository.findById.mockResolvedValue(pendingOrder);
    });

    it('puts the pieces back on the shelf', async () => {
      await ordersService.markPaymentFailed(pendingOrder.id);

      expect(articleRepository.releaseStock).toHaveBeenCalledWith(
        TEA_ID,
        2,
        transactionManager,
      );
    });

    it('returns every line of a multi-article order', async () => {
      orderRepository.findById.mockResolvedValue(
        orderFixture({
          items: [
            {
              articleId: TEA_ID,
              articleName: 'Green tea',
              unitPrice: 12.5,
              quantity: 2,
            },
            {
              articleId: MUG_ID,
              articleName: 'Mug',
              unitPrice: 4.2,
              quantity: 1,
            },
          ],
        }),
      );

      await ordersService.markPaymentFailed(pendingOrder.id);

      expect(articleRepository.releaseStock).toHaveBeenCalledTimes(2);
      expect(articleRepository.releaseStock).toHaveBeenCalledWith(
        MUG_ID,
        1,
        transactionManager,
      );
    });

    it('moves the order from pending to failed', async () => {
      await ordersService.markPaymentFailed(pendingOrder.id);

      expect(orderRepository.transitionStatus).toHaveBeenCalledWith(
        pendingOrder.id,
        OrderStatus.PENDING,
        OrderStatus.FAILED,
        transactionManager,
      );
    });

    it('releases the stock in the same transaction as the status change', async () => {
      await ordersService.markPaymentFailed(pendingOrder.id);

      // A failed release must not leave a failed order with lost stock.
      expect(orderRepository.transitionStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        transactionManager,
      );
      expect(articleRepository.releaseStock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        transactionManager,
      );
    });

    it('returns the stock only once when the same failure arrives twice', async () => {
      // The loser of the conditional status change gets `false`, so a payment
      // result delivered twice cannot return the same pieces twice.
      orderRepository.transitionStatus.mockResolvedValue(false);

      await expect(
        ordersService.markPaymentFailed(pendingOrder.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(articleRepository.releaseStock).not.toHaveBeenCalled();
    });

    it('never releases the stock of an order that was paid', async () => {
      // A paid order needs a refund, not a release, so the conditional status
      // change matches nothing.
      orderRepository.findById.mockResolvedValue(
        orderFixture({ status: OrderStatus.PAID }),
      );
      orderRepository.transitionStatus.mockResolvedValue(false);

      await expect(
        ordersService.markPaymentFailed(pendingOrder.id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(articleRepository.releaseStock).not.toHaveBeenCalled();
    });

    it('throws when the order does not exist', async () => {
      orderRepository.findById.mockResolvedValue(null);

      await expect(
        ordersService.markPaymentFailed('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('still fails the order when an article was deleted meanwhile', async () => {
      // There is no shelf left to put the pieces back on, and that is no
      // reason to leave the order stuck as pending forever.
      articleRepository.releaseStock.mockResolvedValue(false);

      await expect(
        ordersService.markPaymentFailed(pendingOrder.id),
      ).resolves.toBeDefined();
      expect(orderRepository.transitionStatus).toHaveBeenCalled();
    });
  });
});
