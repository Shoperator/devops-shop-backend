import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ArticleRepository } from '../articles/article.repository';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderRepository } from './order.repository';
import { OrdersService } from './orders.service';

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 'b0000000-0000-4000-8000-000000000001',
    buyerId: 'c0000000-0000-4000-8000-000000000001',
    buyer: undefined as unknown as Order['buyer'],
    items: [
      {
        articleId: 'a0000000-0000-4000-8000-000000000001',
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
  let orderRepository: { findPage: jest.Mock; findById: jest.Mock };

  beforeEach(async () => {
    orderRepository = {
      findPage: jest.fn().mockResolvedValue([[], 0]),
      findById: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrderRepository, useValue: orderRepository },
        { provide: ArticleRepository, useValue: {} },
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
});
