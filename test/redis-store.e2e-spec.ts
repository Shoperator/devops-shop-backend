import request from 'supertest';
import { API_PREFIX } from '../src/app.setup';
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

const ARTICLES = `/${API_PREFIX}/articles`;
const ORDERS = `/${API_PREFIX}/orders`;

interface ArticleResponse {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface OrderResponse {
  id: string;
  buyerId: string;
  buyer: { id: string; username: string } | null;
  items: { articleId: string; articleName: string; quantity: number }[];
  total: number;
  status: string;
}

/**
 * The same shop, deployed with `database: redis` instead of PostgreSQL.
 *
 * The point of these is the promises the store makes rather than the HTTP
 * surface, which `articles.e2e-spec` and `orders.e2e-spec` already cover
 * against PostgreSQL: that a Lua script really does hold a basket together, and
 * that the catalogue comes back in the same order out of a sorted set as it
 * does out of an `ORDER BY`.
 */
describe('Redis store (e2e)', () => {
  let testApp: ShopTestApp;
  let server: TestServer;
  let admin: TestSession;
  let customer: TestSession;

  beforeAll(async () => {
    testApp = await startShopApp('redis');
    server = testApp.app.getHttpServer();
    admin = await signInAsAdmin(server);
    customer = await signInAsCustomer(server);
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  let articleCounter = 0;

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

  function buy(
    lines: { articleId: string; quantity: number }[],
    expected = 201,
  ): request.Test {
    return request(server)
      .post(ORDERS)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ items: lines })
      .expect(expected);
  }

  describe('the shop works at all', () => {
    it('seeds the admin account the operator configured', () => {
      expect(admin.user.role).toBe('ADMIN');
    });

    it('registers customers, and refuses a username twice', async () => {
      const username = `twin-${Date.now()}`;
      const registration = {
        username,
        displayName: 'Twin',
        password: 'sup3r-secret',
      };

      await request(server)
        .post(`/${API_PREFIX}/auth/register`)
        .send(registration)
        .expect(201);

      // Redis has no unique index; the username key is the claim instead.
      await request(server)
        .post(`/${API_PREFIX}/auth/register`)
        .send(registration)
        .expect(409);
    });

    it('stores and reads back an article', async () => {
      const created = await createArticle({ name: 'Chamomile', price: 3.75 });

      const read = await readArticle(created.id);

      expect(read).toMatchObject({
        name: 'Chamomile',
        price: 3.75,
        quantity: 8,
      });
    });

    it('searches the catalogue by name', async () => {
      await createArticle({ name: 'Rooibos loose leaf' });

      const response = await request(server)
        .get(`${ARTICLES}?search=rooibos`)
        .expect(200);

      const page = response.body as { items: ArticleResponse[] };
      expect(page.items).not.toHaveLength(0);
      expect(page.items.every((article) => /rooibos/i.test(article.name))).toBe(
        true,
      );
    });

    it('lists the newest article first, the way an ORDER BY would', async () => {
      const older = await createArticle({ name: 'Older' });
      const newer = await createArticle({ name: 'Newer' });

      const response = await request(server)
        .get(`${ARTICLES}?page=1&limit=100`)
        .expect(200);

      const ids = (response.body as { items: ArticleResponse[] }).items.map(
        (article) => article.id,
      );
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });

    it('removes an article from the listing when it is deleted', async () => {
      const article = await createArticle();

      await request(server)
        .delete(`${ARTICLES}/${article.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);

      await request(server).get(`${ARTICLES}/${article.id}`).expect(404);
    });
  });

  describe('checkout is all-or-nothing', () => {
    it('takes the pieces off the shelf and records the order', async () => {
      const article = await createArticle({ quantity: 8 });

      const response = await buy([{ articleId: article.id, quantity: 3 }]);

      expect((response.body as OrderResponse).status).toBe('PENDING');
      expect((await readArticle(article.id)).quantity).toBe(5);
    });

    it('refuses a basket asking for more than is left', async () => {
      const article = await createArticle({ quantity: 2 });

      await buy([{ articleId: article.id, quantity: 3 }], 409);

      expect((await readArticle(article.id)).quantity).toBe(2);
    });

    it('leaves the first line alone when a later line has run out', async () => {
      const plenty = await createArticle({ quantity: 8 });
      const scarce = await createArticle({ quantity: 1 });

      await buy(
        [
          { articleId: plenty.id, quantity: 2 },
          { articleId: scarce.id, quantity: 5 },
        ],
        409,
      );

      // The script checks every line before it decrements any, so nothing was
      // taken off the first shelf and there is no half-order to clean up.
      expect((await readArticle(plenty.id)).quantity).toBe(8);
      expect((await readArticle(scarce.id)).quantity).toBe(1);
    });

    it('sells the last piece to exactly one of two simultaneous customers', async () => {
      const article = await createArticle({ quantity: 1 });
      const second = await signInAsCustomer(server, 'rival');

      const outcomes = await Promise.all([
        request(server)
          .post(ORDERS)
          .set('Authorization', `Bearer ${customer.accessToken}`)
          .send({ items: [{ articleId: article.id, quantity: 1 }] }),
        request(server)
          .post(ORDERS)
          .set('Authorization', `Bearer ${second.accessToken}`)
          .send({ items: [{ articleId: article.id, quantity: 1 }] }),
      ]);

      const statuses = outcomes.map((outcome) => outcome.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect((await readArticle(article.id)).quantity).toBe(0);
    });

    it('refuses an article that is not in the catalogue', async () => {
      await buy(
        [
          {
            articleId: 'a0000000-0000-4000-8000-00000000dead',
            quantity: 1,
          },
        ],
        404,
      );
    });
  });

  describe('orders can be read back', () => {
    it('shows a customer their own orders, newest first', async () => {
      const article = await createArticle({ quantity: 8 });
      const first = await buy([{ articleId: article.id, quantity: 1 }]);
      const second = await buy([{ articleId: article.id, quantity: 1 }]);

      const response = await request(server)
        .get(`${ORDERS}/mine`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      const ids = (response.body as { items: OrderResponse[] }).items.map(
        (order) => order.id,
      );
      expect(ids.indexOf((second.body as OrderResponse).id)).toBeLessThan(
        ids.indexOf((first.body as OrderResponse).id),
      );
    });

    it('tells the admin who placed an order', async () => {
      const article = await createArticle({ quantity: 8 });
      const placed = await buy([{ articleId: article.id, quantity: 1 }]);

      const response = await request(server)
        .get(`${ORDERS}/${(placed.body as OrderResponse).id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // The buyer is a separate hash, read back the way a join would.
      expect((response.body as OrderResponse).buyer).toMatchObject({
        id: customer.user.id,
        username: customer.user.username,
      });
    });

    it('never lets a customer read an order through the admin route', async () => {
      const article = await createArticle({ quantity: 8 });
      const placed = await buy([{ articleId: article.id, quantity: 1 }]);

      await request(server)
        .get(`${ORDERS}/${(placed.body as OrderResponse).id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);
    });
  });

  describe('a payment that fails returns the stock', () => {
    it('puts every line back on the shelf', async () => {
      const article = await createArticle({ quantity: 8 });
      const placed = await buy([{ articleId: article.id, quantity: 3 }]);

      await testApp.app
        .get(OrdersService)
        .markPaymentFailed((placed.body as OrderResponse).id);

      expect((await readArticle(article.id)).quantity).toBe(8);
    });

    it('does not return the same pieces twice', async () => {
      const article = await createArticle({ quantity: 8 });
      const placed = await buy([{ articleId: article.id, quantity: 3 }]);
      const orders = testApp.app.get(OrdersService);
      const id = (placed.body as OrderResponse).id;

      await orders.markPaymentFailed(id);
      // The status check and the release are in one script, so a payment result
      // delivered twice cannot restock the shop.
      await expect(orders.markPaymentFailed(id)).rejects.toThrow();

      expect((await readArticle(article.id)).quantity).toBe(8);
    });

    it('still fails the order when the article was deleted meanwhile', async () => {
      const article = await createArticle({ quantity: 8 });
      const placed = await buy([{ articleId: article.id, quantity: 3 }]);

      await request(server)
        .delete(`${ARTICLES}/${article.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);

      // There is no shelf left to put the pieces back on, and that is no reason
      // to leave the order stuck as pending forever.
      const failed = await testApp.app
        .get(OrdersService)
        .markPaymentFailed((placed.body as OrderResponse).id);

      expect(failed.status).toBe('FAILED');
    });
  });
});
