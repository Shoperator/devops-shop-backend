import request from 'supertest';
import { OrderStatus } from '../src/orders/entities/order.entity';
import {
  ANVIL_ACCOUNTS,
  ANVIL_CHAIN_ID,
  ethToWei,
  payFromWallet,
  rpc,
  waitForMined,
} from './anvil';
import {
  ShopTestApp,
  signInAsAdmin,
  signInAsCustomer,
  startShopApp,
  stopShopApp,
  TestServer,
  TestSession,
} from './shop-app';

const ARTICLES = '/api/v1/articles';
const ORDERS = '/api/v1/orders';
const PAYMENT_CONFIG = '/api/v1/payment-config';

interface ArticleResponse {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface OrderResponse {
  id: string;
  total: number;
  currency: string;
  status: OrderStatus;
  walletAddress: string | null;
  transactionHash: string | null;
}

const UNKNOWN_TX =
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/**
 * The payment path against a real chain.
 *
 * Everything here that matters is a claim a mock cannot check: that a transfer
 * of the right amount to the right address marks the order paid, and that
 * anything else does not. The chain is Anvil in a container, so the shop's
 * verifier is talking real JSON-RPC to a real EVM rather than to a stub that
 * agrees with whatever it is asked.
 */
describe('Payments (e2e)', () => {
  let testApp: ShopTestApp;
  let server: TestServer;
  let rpcUrl: string;
  let admin: TestSession;
  let customer: TestSession;

  beforeAll(async () => {
    testApp = await startShopApp({ store: 'postgres', withChain: true });
    server = testApp.app.getHttpServer();
    rpcUrl = testApp.anvil!.rpcUrl;
    admin = await signInAsAdmin(server);
    customer = await signInAsCustomer(server);
  }, 240_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  let articleCounter = 0;

  async function createArticle(price: number, quantity = 10): Promise<ArticleResponse> {
    articleCounter += 1;
    const response = await request(server)
      .post(ARTICLES)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: `Payable article ${articleCounter}`, price, quantity })
      .expect(201);

    return response.body as ArticleResponse;
  }

  async function checkout(
    articleId: string,
    quantity = 1,
    session: TestSession = customer,
  ): Promise<OrderResponse> {
    const response = await request(server)
      .post(ORDERS)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ items: [{ articleId, quantity }] })
      .expect(201);

    return response.body as OrderResponse;
  }

  function submitPayment(
    orderId: string,
    transactionHash: string,
    session: TestSession = customer,
  ) {
    return request(server)
      .post(`${ORDERS}/${orderId}/payment`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ transactionHash });
  }

  /** Pays an order in full from the buyer's wallet, and waits for the block. */
  async function payInFull(order: OrderResponse): Promise<string> {
    const hash = await payFromWallet(rpcUrl, {
      to: order.walletAddress!,
      wei: ethToWei(order.total),
    });
    await waitForMined(rpcUrl, hash);
    return hash;
  }

  describe('payment configuration', () => {
    it('publishes the chain and the address, and no RPC URL', async () => {
      const response = await request(server).get(PAYMENT_CONFIG).expect(200);

      expect(response.body).toEqual({
        walletAddress: ANVIL_ACCOUNTS.shop,
        chainId: ANVIL_CHAIN_ID,
        currency: 'ETH',
        enabled: true,
      });
      // The backend's RPC endpoint is a cluster-internal address; publishing it
      // would tell the world about the cluster and help nobody.
      expect(JSON.stringify(response.body)).not.toContain(rpcUrl);
    });

    it('is readable without signing in', async () => {
      await request(server).get(PAYMENT_CONFIG).expect(200);
    });
  });

  describe('checkout', () => {
    it('stamps the shop wallet onto the order', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      expect(order.walletAddress).toBe(ANVIL_ACCOUNTS.shop);
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.currency).toBe('ETH');
    });
  });

  describe('a payment that really happened', () => {
    it('marks the order paid and records the transaction', async () => {
      const article = await createArticle(2.5);
      const order = await checkout(article.id);
      const hash = await payInFull(order);

      const response = await submitPayment(order.id, hash).expect(201);
      const paid = response.body as OrderResponse;

      expect(paid.status).toBe(OrderStatus.PAID);
      expect(paid.transactionHash).toBe(hash);
    });

    it('actually moved the money to the shop', async () => {
      const article = await createArticle(3.25);
      const order = await checkout(article.id);

      const before = BigInt(
        await rpc<string>(rpcUrl, 'eth_getBalance', [
          ANVIL_ACCOUNTS.shop,
          'latest',
        ]),
      );
      const hash = await payInFull(order);
      await submitPayment(order.id, hash).expect(201);

      const after = BigInt(
        await rpc<string>(rpcUrl, 'eth_getBalance', [
          ANVIL_ACCOUNTS.shop,
          'latest',
        ]),
      );
      expect(after - before).toBe(ethToWei(order.total));
    });

    it('accepts an overpayment', async () => {
      const article = await createArticle(1.25);
      const order = await checkout(article.id);

      const hash = await payFromWallet(rpcUrl, {
        to: order.walletAddress!,
        wei: ethToWei(order.total) + 1n,
      });
      await waitForMined(rpcUrl, hash);

      await submitPayment(order.id, hash).expect(201);
    });

    it('leaves the stock sold rather than putting it back', async () => {
      const article = await createArticle(1, 5);
      const order = await checkout(article.id, 2);
      await submitPayment(order.id, await payInFull(order)).expect(201);

      const response = await request(server)
        .get(`${ARTICLES}/${article.id}`)
        .expect(200);
      expect((response.body as ArticleResponse).quantity).toBe(3);
    });
  });

  describe('a payment that did not', () => {
    it('refuses a transaction the chain has never seen', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      await submitPayment(order.id, UNKNOWN_TX).expect(422);
    });

    it('refuses a transfer that paid somebody else', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      const hash = await payFromWallet(rpcUrl, {
        to: ANVIL_ACCOUNTS.stranger,
        wei: ethToWei(order.total),
      });
      await waitForMined(rpcUrl, hash);

      await submitPayment(order.id, hash).expect(422);
    });

    it('refuses a transfer one wei short', async () => {
      // The boundary is where the money is: a shop that rounds this in the
      // customer's favour is a shop that can be underpaid by design.
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      const hash = await payFromWallet(rpcUrl, {
        to: order.walletAddress!,
        wei: ethToWei(order.total) - 1n,
      });
      await waitForMined(rpcUrl, hash);

      await submitPayment(order.id, hash).expect(422);
    });

    it('leaves the order pending after a rejected payment', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);
      await submitPayment(order.id, UNKNOWN_TX).expect(422);

      const response = await request(server)
        .get(`${ORDERS}/${order.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect((response.body as OrderResponse).status).toBe(OrderStatus.PENDING);
    });

    it('rejects a malformed hash without asking the chain', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      await submitPayment(order.id, 'not-a-hash').expect(400);
    });
  });

  describe('one transaction, one order', () => {
    it('refuses to settle a second order with the same transaction', async () => {
      // The whole risk of trusting a client-supplied hash: pay once, claim
      // every basket you own.
      const first = await checkout((await createArticle(1.5)).id);
      const second = await checkout((await createArticle(1.5)).id);

      const hash = await payInFull(first);
      await submitPayment(first.id, hash).expect(201);

      await submitPayment(second.id, hash).expect(409);
    });

    it('refuses to pay the same order twice', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);
      const hash = await payInFull(order);

      await submitPayment(order.id, hash).expect(201);
      await submitPayment(order.id, hash).expect(409);
    });

    it('settles the order once when two requests race', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);
      const hash = await payInFull(order);

      const results = await Promise.all([
        submitPayment(order.id, hash),
        submitPayment(order.id, hash),
      ]);

      const statuses = results.map((result) => result.status).sort();
      expect(statuses).toEqual([201, 409]);
    });
  });

  describe('whose order it is', () => {
    it("will not let a customer pay somebody else's order", async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);
      const hash = await payInFull(order);

      const stranger = await signInAsCustomer(server, 'stranger');
      // 404 rather than 403: answering "forbidden" would confirm the order
      // exists and let anyone enumerate orders by id.
      await submitPayment(order.id, hash, stranger).expect(404);
    });

    it('will not let the admin pay an order', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);
      const hash = await payInFull(order);

      await submitPayment(order.id, hash, admin).expect(403);
    });

    it('needs a signed-in customer at all', async () => {
      const article = await createArticle(1.5);
      const order = await checkout(article.id);

      await request(server)
        .post(`${ORDERS}/${order.id}/payment`)
        .send({ transactionHash: UNKNOWN_TX })
        .expect(401);
    });
  });
});
