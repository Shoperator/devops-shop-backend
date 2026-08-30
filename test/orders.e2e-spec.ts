import request from 'supertest';
import { OrderItem } from '../src/orders/entities/order-item';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { OrderRepository } from '../src/orders/order.repository';
import {
  ShopTestApp,
  signInAsAdmin,
  signInAsCustomer,
  startShopApp,
  stopShopApp,
  TestServer,
  TestSession,
} from './shop-app';

const ORDERS = '/api/v1/orders';

interface OrderResponse {
  id: string;
  buyerId: string;
  buyer: { id: string; username: string; displayName: string } | null;
  items: OrderItem[];
  total: number;
  currency: string;
  status: OrderStatus;
  walletAddress: string | null;
  transactionHash: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderPage {
  items: OrderResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const UNKNOWN_ID = 'b0000000-0000-4000-8000-0000000000ff';

/**
 * Checkout belongs to the customer purchase ticket, so the orders the admin
 * lists here are written straight through the repository.
 */
describe('Orders (e2e)', () => {
  let testApp: ShopTestApp;
  let server: TestServer;
  let orderRepository: OrderRepository;
  let admin: TestSession;
  let customer: TestSession;

  beforeAll(async () => {
    testApp = await startShopApp();
    server = testApp.app.getHttpServer();
    orderRepository = testApp.app.get(OrderRepository);
    admin = await signInAsAdmin(server);
    customer = await signInAsCustomer(server);
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  function seedOrder(overrides: Partial<Order> = {}): Promise<Order> {
    return orderRepository.save(
      orderRepository.create({
        buyerId: customer.user.id,
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
        ...overrides,
      }),
    );
  }

  async function listAsAdmin(queryString = ''): Promise<OrderPage> {
    const response = await request(server)
      .get(`${ORDERS}${queryString ? `?${queryString}` : ''}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    return response.body as OrderPage;
  }

  describe('GET /orders', () => {
    it('lists the orders customers placed', async () => {
      const order = await seedOrder();

      const page = await listAsAdmin();

      expect(page.items.map((item) => item.id)).toContain(order.id);
      expect(page.total).toBeGreaterThan(0);
    });

    it('shows who placed the order', async () => {
      const order = await seedOrder();

      const page = await listAsAdmin();
      const listed = page.items.find((item) => item.id === order.id);

      expect(listed?.buyer).toEqual({
        id: customer.user.id,
        username: customer.user.username,
        displayName: customer.user.displayName,
      });
    });

    it('never leaks the buyer password hash', async () => {
      await seedOrder();

      const page = await listAsAdmin();

      expect(JSON.stringify(page)).not.toContain('passwordHash');
      expect(JSON.stringify(page)).not.toContain('$2b$');
    });

    it('keeps the article name and price as they were at purchase time', async () => {
      const order = await seedOrder();

      const page = await listAsAdmin();
      const listed = page.items.find((item) => item.id === order.id);

      expect(listed?.items).toEqual([
        {
          articleId: 'a0000000-0000-4000-8000-000000000001',
          articleName: 'Green tea',
          unitPrice: 12.5,
          quantity: 2,
        },
      ]);
      expect(listed?.total).toBe(25);
      expect(listed?.currency).toBe('USDT');
    });

    it('returns the newest orders first', async () => {
      await seedOrder();
      await seedOrder();

      const page = await listAsAdmin('limit=2');

      const created = page.items.map((item) => Date.parse(item.createdAt));
      expect(created).toEqual([...created].sort((a, b) => b - a));
    });

    it('splits the orders into pages', async () => {
      await seedOrder();
      await seedOrder();

      const first = await listAsAdmin('page=1&limit=1');
      const second = await listAsAdmin('page=2&limit=1');

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      expect(first.totalPages).toBe(first.total);
    });

    it('narrows the list down to one status', async () => {
      const paid = await seedOrder({ status: OrderStatus.PAID });
      const pending = await seedOrder({ status: OrderStatus.PENDING });

      const page = await listAsAdmin('status=PAID&limit=100');
      const ids = page.items.map((item) => item.id);

      expect(ids).toContain(paid.id);
      expect(ids).not.toContain(pending.id);
      expect(page.items.every((item) => item.status === OrderStatus.PAID)).toBe(
        true,
      );
    });

    it('rejects a status that is not one of the known ones', async () => {
      await request(server)
        .get(`${ORDERS}?status=DEFINITELY_NOT_A_STATUS`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(400);
    });

    it('rejects a page size beyond the cap', async () => {
      await request(server)
        .get(`${ORDERS}?limit=1000`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(400);
    });

    it('refuses a customer, who must not see other buyers orders', async () => {
      await seedOrder();

      await request(server)
        .get(ORDERS)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);
    });

    it('refuses an anonymous request', async () => {
      await request(server).get(ORDERS).expect(401);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns the order to the admin', async () => {
      const order = await seedOrder({ transactionHash: '0xdeadbeef' });

      const response = await request(server)
        .get(`${ORDERS}/${order.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(response.body as OrderResponse).toMatchObject({
        id: order.id,
        buyerId: customer.user.id,
        status: OrderStatus.PENDING,
        transactionHash: '0xdeadbeef',
      });
    });

    it('answers 404 for an id that does not exist', async () => {
      await request(server)
        .get(`${ORDERS}/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });

    it('answers 400 for an id that is not a uuid', async () => {
      await request(server)
        .get(`${ORDERS}/not-a-uuid`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(400);
    });

    it('refuses a customer', async () => {
      const order = await seedOrder();

      await request(server)
        .get(`${ORDERS}/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);
    });

    it('refuses an anonymous request', async () => {
      const order = await seedOrder();

      await request(server).get(`${ORDERS}/${order.id}`).expect(401);
    });
  });
});
