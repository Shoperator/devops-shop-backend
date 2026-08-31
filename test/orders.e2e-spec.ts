import request from 'supertest';
import { OrderItem } from '../src/orders/entities/order-item';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { OrderRepository } from '../src/orders/order.repository';
import { OrdersService } from '../src/orders/orders.service';
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
const ARTICLES = '/api/v1/articles';

interface ArticleResponse {
  id: string;
  name: string;
  price: number;
  quantity: number;
  inStock: boolean;
}

describe('Orders (e2e)', () => {
  let testApp: ShopTestApp;
  let server: TestServer;
  let orderRepository: OrderRepository;
  let ordersService: OrdersService;
  let admin: TestSession;
  let customer: TestSession;

  beforeAll(async () => {
    testApp = await startShopApp();
    server = testApp.app.getHttpServer();
    orderRepository = testApp.app.get(OrderRepository);
    ordersService = testApp.app.get(OrdersService);
    admin = await signInAsAdmin(server);
    customer = await signInAsCustomer(server);
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  let articleCounter = 0;

  /** Puts an article in the catalogue the way the admin would. */
  async function createArticle(
    overrides: Record<string, unknown> = {},
  ): Promise<ArticleResponse> {
    articleCounter += 1;

    const response = await request(server)
      .post(ARTICLES)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: `Green tea ${articleCounter}`,
        price: 12.5,
        quantity: 8,
        ...overrides,
      })
      .expect(201);

    return response.body as ArticleResponse;
  }

  async function readArticle(id: string): Promise<ArticleResponse> {
    const response = await request(server).get(`${ARTICLES}/${id}`).expect(200);
    return response.body as ArticleResponse;
  }

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

  describe('POST /orders', () => {
    /** Returns the supertest request so the caller can chain `.expect()`. */
    function checkout(
      items: { articleId: string; quantity: number }[],
      token = customer.accessToken,
    ) {
      return request(server)
        .post(ORDERS)
        .set('Authorization', `Bearer ${token}`)
        .send({ items });
    }

    it('turns a basket into an unpaid order', async () => {
      const article = await createArticle();

      const response = await checkout([
        { articleId: article.id, quantity: 2 },
      ]).expect(201);

      expect(response.body as OrderResponse).toMatchObject({
        buyerId: customer.user.id,
        // The money has not moved yet, so nothing may claim it has.
        status: OrderStatus.PENDING,
        currency: 'USDT',
        total: 25,
        transactionHash: null,
      });
    });

    it('snapshots the article name and price into the order', async () => {
      const article = await createArticle({ name: 'Rooibos', price: 9.99 });

      const response = await checkout([
        { articleId: article.id, quantity: 3 },
      ]).expect(201);

      expect((response.body as OrderResponse).items).toEqual([
        {
          articleId: article.id,
          articleName: 'Rooibos',
          unitPrice: 9.99,
          quantity: 3,
        },
      ]);
      expect((response.body as OrderResponse).total).toBe(29.97);
    });

    it('keeps the order readable after the article is repriced', async () => {
      const article = await createArticle({ price: 10 });
      const response = await checkout([
        { articleId: article.id, quantity: 1 },
      ]).expect(201);

      await request(server)
        .patch(`${ARTICLES}/${article.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ price: 99 })
        .expect(200);

      const stored = await request(server)
        .get(`${ORDERS}/${(response.body as OrderResponse).id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect((stored.body as OrderResponse).items[0].unitPrice).toBe(10);
      expect((stored.body as OrderResponse).total).toBe(10);
    });

    it('takes the bought pieces off the shelf', async () => {
      const article = await createArticle({ quantity: 8 });

      await checkout([{ articleId: article.id, quantity: 3 }]).expect(201);

      expect((await readArticle(article.id)).quantity).toBe(5);
    });

    it('sells the last piece and marks the article out of stock', async () => {
      const article = await createArticle({ quantity: 1 });

      await checkout([{ articleId: article.id, quantity: 1 }]).expect(201);

      const sold = await readArticle(article.id);
      expect(sold.quantity).toBe(0);
      expect(sold.inStock).toBe(false);
    });

    it('refuses to sell more pieces than the shop has', async () => {
      const article = await createArticle({ quantity: 2 });

      await checkout([{ articleId: article.id, quantity: 3 }]).expect(409);

      // Nothing was reserved, so the stock is untouched.
      expect((await readArticle(article.id)).quantity).toBe(2);
    });

    it('refuses an article that is already sold out', async () => {
      const article = await createArticle({ quantity: 0 });

      await checkout([{ articleId: article.id, quantity: 1 }]).expect(409);
    });

    it('leaves the whole basket alone when one line cannot be filled', async () => {
      const available = await createArticle({ quantity: 5 });
      const soldOut = await createArticle({ quantity: 0 });

      await checkout([
        { articleId: available.id, quantity: 1 },
        { articleId: soldOut.id, quantity: 1 },
      ]).expect(409);

      // The first line was reserved before the second one failed; the
      // transaction has to have put those pieces back.
      expect((await readArticle(available.id)).quantity).toBe(5);
    });

    it('writes no order when the basket cannot be filled', async () => {
      const soldOut = await createArticle({ quantity: 0 });
      const before = await listAsAdmin('limit=100');

      await checkout([{ articleId: soldOut.id, quantity: 1 }]).expect(409);

      const after = await listAsAdmin('limit=100');
      expect(after.total).toBe(before.total);
    });

    it('answers 404 for an article that no longer exists', async () => {
      const article = await createArticle();
      await request(server)
        .delete(`${ARTICLES}/${article.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);

      await checkout([{ articleId: article.id, quantity: 1 }]).expect(404);
    });

    it('rejects an empty basket', async () => {
      await checkout([]).expect(400);
    });

    it('rejects the same article twice in one basket', async () => {
      const article = await createArticle();

      await checkout([
        { articleId: article.id, quantity: 1 },
        { articleId: article.id, quantity: 1 },
      ]).expect(400);
    });

    it('rejects a quantity below one', async () => {
      const article = await createArticle();

      await checkout([{ articleId: article.id, quantity: 0 }]).expect(400);
    });

    it('ignores a price the client tried to set', async () => {
      const article = await createArticle({ price: 12.5 });

      // `forbidNonWhitelisted` rejects the request outright rather than
      // quietly dropping the field.
      await request(server)
        .post(ORDERS)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          items: [{ articleId: article.id, quantity: 1, unitPrice: 0.01 }],
        })
        .expect(400);
    });

    it('refuses the admin, who manages the shop rather than buying from it', async () => {
      const article = await createArticle();

      await checkout(
        [{ articleId: article.id, quantity: 1 }],
        admin.accessToken,
      ).expect(403);
    });

    it('refuses an anonymous request', async () => {
      const article = await createArticle();

      await request(server)
        .post(ORDERS)
        .send({ items: [{ articleId: article.id, quantity: 1 }] })
        .expect(401);
    });

    it('shows up in the admin listing', async () => {
      const article = await createArticle();

      const response = await checkout([
        { articleId: article.id, quantity: 1 },
      ]).expect(201);

      const page = await listAsAdmin('limit=100');
      expect(page.items.map((item) => item.id)).toContain(
        (response.body as OrderResponse).id,
      );
    });
  });

  /**
   * The blockchain payment integration is what will call this; there is no
   * endpoint for it, so the tests drive the service the same way that code
   * will.
   */
  describe('releasing the stock of a failed payment', () => {
    async function buy(
      articleId: string,
      quantity = 1,
    ): Promise<OrderResponse> {
      const response = await request(server)
        .post(ORDERS)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ items: [{ articleId, quantity }] })
        .expect(201);

      return response.body as OrderResponse;
    }

    it('puts the reserved pieces back on the shelf', async () => {
      const article = await createArticle({ quantity: 8 });
      const order = await buy(article.id, 3);
      expect((await readArticle(article.id)).quantity).toBe(5);

      await ordersService.markPaymentFailed(order.id);

      expect((await readArticle(article.id)).quantity).toBe(8);
    });

    it('puts an article that had sold out back on sale', async () => {
      const article = await createArticle({ quantity: 1 });
      const order = await buy(article.id, 1);
      expect((await readArticle(article.id)).inStock).toBe(false);

      await ordersService.markPaymentFailed(order.id);

      const restocked = await readArticle(article.id);
      expect(restocked.quantity).toBe(1);
      expect(restocked.inStock).toBe(true);
    });

    it('marks the order as failed', async () => {
      const article = await createArticle();
      const order = await buy(article.id);

      const failed = await ordersService.markPaymentFailed(order.id);

      expect(failed.status).toBe(OrderStatus.FAILED);
    });

    it('returns every line of a multi-article order', async () => {
      const tea = await createArticle({ quantity: 5 });
      const mug = await createArticle({ quantity: 4 });

      const response = await request(server)
        .post(ORDERS)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          items: [
            { articleId: tea.id, quantity: 2 },
            { articleId: mug.id, quantity: 1 },
          ],
        })
        .expect(201);

      await ordersService.markPaymentFailed(
        (response.body as OrderResponse).id,
      );

      expect((await readArticle(tea.id)).quantity).toBe(5);
      expect((await readArticle(mug.id)).quantity).toBe(4);
    });

    it('does not return the same pieces twice', async () => {
      const article = await createArticle({ quantity: 8 });
      const order = await buy(article.id, 3);

      await ordersService.markPaymentFailed(order.id);
      // A payment result delivered twice must not restock the shop.
      await expect(ordersService.markPaymentFailed(order.id)).rejects.toThrow();

      expect((await readArticle(article.id)).quantity).toBe(8);
    });

    it('never releases the stock of an order that was paid', async () => {
      const article = await createArticle({ quantity: 8 });
      const order = await buy(article.id, 3);
      await orderRepository.transitionStatus(
        order.id,
        OrderStatus.PENDING,
        OrderStatus.PAID,
      );

      await expect(ordersService.markPaymentFailed(order.id)).rejects.toThrow();

      expect((await readArticle(article.id)).quantity).toBe(5);
    });

    it('the released pieces can be bought again', async () => {
      const article = await createArticle({ quantity: 1 });
      const first = await buy(article.id, 1);

      await ordersService.markPaymentFailed(first.id);

      // The whole point: the piece is genuinely back on sale, not just a
      // number in a column.
      await buy(article.id, 1);
      expect((await readArticle(article.id)).quantity).toBe(0);
    });

    it('still fails the order when the article was deleted meanwhile', async () => {
      const article = await createArticle();
      const order = await buy(article.id);
      await request(server)
        .delete(`${ARTICLES}/${article.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);

      const failed = await ordersService.markPaymentFailed(order.id);

      expect(failed.status).toBe(OrderStatus.FAILED);
    });

    it('shows up in the admin listing under the failed filter', async () => {
      const article = await createArticle();
      const order = await buy(article.id);

      await ordersService.markPaymentFailed(order.id);

      const page = await listAsAdmin('status=FAILED&limit=100');
      expect(page.items.map((item) => item.id)).toContain(order.id);
    });
  });

  describe('GET /orders/mine', () => {
    async function listMine(session: TestSession): Promise<OrderPage> {
      const response = await request(server)
        .get(`${ORDERS}/mine?limit=100`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      return response.body as OrderPage;
    }

    it('returns the orders this customer placed', async () => {
      const article = await createArticle();
      const response = await request(server)
        .post(ORDERS)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ items: [{ articleId: article.id, quantity: 1 }] })
        .expect(201);

      const page = await listMine(customer);

      expect(page.items.map((item) => item.id)).toContain(
        (response.body as OrderResponse).id,
      );
    });

    it('never shows another customer their orders', async () => {
      const other = await signInAsCustomer(server, 'nosy');
      const mine = await seedOrder();

      const page = await listMine(other);

      expect(page.items.map((item) => item.id)).not.toContain(mine.id);
      expect(page.items.every((item) => item.buyerId === other.user.id)).toBe(
        true,
      );
    });

    it('refuses the admin, who has the full listing instead', async () => {
      await request(server)
        .get(`${ORDERS}/mine`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(403);
    });

    it('refuses an anonymous request', async () => {
      await request(server).get(`${ORDERS}/mine`).expect(401);
    });
  });

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
