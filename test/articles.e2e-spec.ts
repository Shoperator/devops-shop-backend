import request from 'supertest';
import {
  ShopTestApp,
  signInAsAdmin,
  signInAsCustomer,
  startShopApp,
  stopShopApp,
  TestServer,
} from './shop-app';

const ARTICLES = '/api/v1/articles';

interface ArticleResponse {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  inStock: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ArticlePage {
  items: ArticleResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const UNKNOWN_ID = 'a0000000-0000-4000-8000-0000000000ff';

describe('Articles (e2e)', () => {
  let testApp: ShopTestApp;
  let server: TestServer;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    testApp = await startShopApp();
    server = testApp.app.getHttpServer();
    adminToken = (await signInAsAdmin(server)).accessToken;
    customerToken = (await signInAsCustomer(server)).accessToken;
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  let nameCounter = 0;

  /** The suite shares one database, so names have to stay distinguishable. */
  function uniqueName(prefix: string): string {
    nameCounter += 1;
    return `${prefix} ${nameCounter}`;
  }

  async function createArticle(
    overrides: Record<string, unknown> = {},
  ): Promise<ArticleResponse> {
    const response = await request(server)
      .post(ARTICLES)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: uniqueName('Green tea'),
        description: 'Loose leaf, 100g',
        price: 12.5,
        quantity: 8,
        ...overrides,
      })
      .expect(201);

    return response.body as ArticleResponse;
  }

  async function search(queryString: string): Promise<ArticlePage> {
    const response = await request(server)
      .get(`${ARTICLES}?${queryString}`)
      .expect(200);
    return response.body as ArticlePage;
  }

  describe('POST /articles', () => {
    it('lets the admin add an article', async () => {
      const article = await createArticle({ name: 'Chamomile' });

      expect(article).toMatchObject({
        id: expect.any(String) as string,
        name: 'Chamomile',
        description: 'Loose leaf, 100g',
        price: 12.5,
        quantity: 8,
        inStock: true,
      });
    });

    it('marks an article with no pieces left as out of stock', async () => {
      const article = await createArticle({ quantity: 0 });

      expect(article.inStock).toBe(false);
    });

    it('keeps the price exact instead of rounding it', async () => {
      const article = await createArticle({ price: 0.01 });

      expect(article.price).toBe(0.01);
    });

    it('refuses a customer', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Sneaky', price: 1, quantity: 1 })
        .expect(403);
    });

    it('refuses an anonymous request', async () => {
      await request(server)
        .post(ARTICLES)
        .send({ name: 'Sneaky', price: 1, quantity: 1 })
        .expect(401);
    });

    it('rejects a negative price', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Free money', price: -1, quantity: 1 })
        .expect(400);
    });

    it('rejects a negative stock count', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Negative stock', price: 1, quantity: -1 })
        .expect(400);
    });

    it('rejects a fractional stock count', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Half a mug', price: 1, quantity: 1.5 })
        .expect(400);
    });

    it('rejects a price the numeric(18, 2) column cannot hold exactly', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Too precise', price: 1.005, quantity: 1 })
        .expect(400);
    });

    it('rejects an unknown property instead of silently dropping it', async () => {
      await request(server)
        .post(ARTICLES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Smuggler', price: 1, quantity: 1, id: UNKNOWN_ID })
        .expect(400);
    });
  });

  describe('GET /articles', () => {
    it('is readable without signing in, so visitors can browse', async () => {
      await createArticle();

      const page = await search('limit=1');

      expect(page.items.length).toBe(1);
      expect(page.total).toBeGreaterThan(0);
    });

    it('returns the newest articles first', async () => {
      const older = await createArticle({ name: uniqueName('Older') });
      const newer = await createArticle({ name: uniqueName('Newer') });

      const page = await search('limit=2');

      // Compared on the timestamps rather than on a fixed id order: two
      // articles created in the same millisecond are a legitimate tie.
      const created = page.items.map((item) => Date.parse(item.createdAt));
      expect(created).toEqual([...created].sort((a, b) => b - a));
      expect(page.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([newer.id, older.id]),
      );
    });

    it('splits the catalogue into pages', async () => {
      await createArticle();
      await createArticle();

      const first = await search('page=1&limit=1');
      const second = await search('page=2&limit=1');

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      // One article per page, so there are as many pages as there are articles.
      expect(first.totalPages).toBe(first.total);
    });

    it('finds an article by a fragment of its name', async () => {
      const article = await createArticle({ name: 'Rooibos Vanilla' });

      const page = await search('search=rooibos');

      expect(page.items.map((item) => item.id)).toContain(article.id);
    });

    it('finds an article by a fragment of its description', async () => {
      const article = await createArticle({
        name: uniqueName('Mystery'),
        description: 'hand picked in Assam',
      });

      const page = await search('search=assam');

      expect(page.items.map((item) => item.id)).toContain(article.id);
    });

    it('returns an empty page when nothing matches', async () => {
      const page = await search('search=nothing-matches-this-term');

      expect(page).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });

    it('rejects a page size beyond the cap', async () => {
      await request(server).get(`${ARTICLES}?limit=1000`).expect(400);
    });

    it('rejects a page number below one', async () => {
      await request(server).get(`${ARTICLES}?page=0`).expect(400);
    });
  });

  describe('GET /articles/:id', () => {
    it('returns the article', async () => {
      const created = await createArticle();

      const response = await request(server)
        .get(`${ARTICLES}/${created.id}`)
        .expect(200);

      expect(response.body as ArticleResponse).toEqual(created);
    });

    it('answers 404 for an id that does not exist', async () => {
      await request(server).get(`${ARTICLES}/${UNKNOWN_ID}`).expect(404);
    });

    it('answers 400 for an id that is not a uuid', async () => {
      await request(server).get(`${ARTICLES}/not-a-uuid`).expect(400);
    });
  });

  describe('PATCH /articles/:id', () => {
    it('restocks an article without touching anything else', async () => {
      const created = await createArticle();

      const response = await request(server)
        .patch(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 40 })
        .expect(200);

      const updated = response.body as ArticleResponse;
      expect(updated.quantity).toBe(40);
      expect(updated.name).toBe(created.name);
      expect(updated.description).toBe(created.description);
      expect(updated.price).toBe(created.price);
    });

    it('changes the price', async () => {
      const created = await createArticle();

      const response = await request(server)
        .patch(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 19.99 })
        .expect(200);

      expect((response.body as ArticleResponse).price).toBe(19.99);
    });

    it('clears the description when it is set to null', async () => {
      const created = await createArticle();

      const response = await request(server)
        .patch(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: null })
        .expect(200);

      expect((response.body as ArticleResponse).description).toBeNull();
    });

    it('refuses a customer', async () => {
      const created = await createArticle();

      await request(server)
        .patch(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ price: 0.01 })
        .expect(403);
    });

    it('refuses an anonymous request', async () => {
      const created = await createArticle();

      await request(server)
        .patch(`${ARTICLES}/${created.id}`)
        .send({ price: 0.01 })
        .expect(401);
    });

    it('answers 404 for an id that does not exist', async () => {
      await request(server)
        .patch(`${ARTICLES}/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 1 })
        .expect(404);
    });
  });

  describe('DELETE /articles/:id', () => {
    it('removes the article from the catalogue', async () => {
      const created = await createArticle();

      await request(server)
        .delete(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(server).get(`${ARTICLES}/${created.id}`).expect(404);
    });

    it('answers 404 when the article is already gone', async () => {
      const created = await createArticle();

      await request(server)
        .delete(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(server)
        .delete(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('refuses a customer', async () => {
      const created = await createArticle();

      await request(server)
        .delete(`${ARTICLES}/${created.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);

      await request(server).get(`${ARTICLES}/${created.id}`).expect(200);
    });

    it('refuses an anonymous request', async () => {
      const created = await createArticle();

      await request(server).delete(`${ARTICLES}/${created.id}`).expect(401);
    });
  });
});
