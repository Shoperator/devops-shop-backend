import request from 'supertest';
import { ShopTestApp, startShopApp, stopShopApp } from './shop-app';

describe('AppController (e2e)', () => {
  let testApp: ShopTestApp;

  beforeAll(async () => {
    testApp = await startShopApp();
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  it('serves the root under the api/v1 prefix', () => {
    return request(testApp.app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Hello World!');
  });

  it('does not serve anything outside the prefix', () => {
    return request(testApp.app.getHttpServer()).get('/').expect(404);
  });
});
