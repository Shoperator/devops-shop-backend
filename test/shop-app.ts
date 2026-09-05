import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { StartedTestContainer } from 'testcontainers';
import request from 'supertest';
import { App } from 'supertest/types';
import { API_PREFIX, configureApp } from '../src/app.setup';
import { UserRole } from '../src/users/entities/user.entity';

/** Credentials the AdminSeeder provisions while the tests run. */
export const SEEDED_ADMIN = {
  username: 'shop-admin',
  password: 'admin-password',
  displayName: 'Integration Admin',
};

/** Which database the shop under test was "deployed" with. */
export type TestStore = 'postgres' | 'redis';

export interface ShopTestApp {
  app: INestApplication<App>;
  container: StartedTestContainer;
}

/**
 * Boots the whole application against a throwaway database, so the integration
 * tests hit a real store, real guards and the real validation pipeline.
 *
 * `AppModule` is imported here rather than at the top of the file on purpose:
 * it decides which repositories exist from `DB_KIND` while its decorator is
 * evaluated, so the environment has to be set before the module is loaded. Jest
 * gives every test file its own module registry, so each suite gets the store
 * it asked for.
 */
export async function startShopApp(
  store: TestStore = 'postgres',
): Promise<ShopTestApp> {
  const container =
    store === 'redis' ? await startRedis() : await startPostgres();

  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.SHOP_ADMIN_USERNAME = SEEDED_ADMIN.username;
  process.env.SHOP_ADMIN_PASSWORD = SEEDED_ADMIN.password;
  process.env.SHOP_ADMIN_DISPLAY_NAME = SEEDED_ADMIN.displayName;

  const { AppModule } = loadAppModule();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  return { app, container };
}

/**
 * Loads the application module after the environment is in place.
 *
 * A top-level import would be hoisted above the settings above, and `AppModule`
 * decides which repositories exist while it is being evaluated — so by then the
 * store would already be chosen. `require` rather than `import()` because Jest
 * runs this as CommonJS, and its module registry is per test file, so each
 * suite still gets its own evaluation.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
function loadAppModule(): typeof import('../src/app.module') {
  return require('../src/app.module') as typeof import('../src/app.module');
}
/* eslint-enable @typescript-eslint/no-require-imports */

// ConfigService reads process.env first, so these win over any local .env.
async function startPostgres(): Promise<StartedTestContainer> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  process.env.DB_KIND = 'postgresql';
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_USERNAME = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();
  process.env.DB_NAME = container.getDatabase();
  process.env.DB_SYNCHRONIZE = 'true';

  return container;
}

async function startRedis(): Promise<StartedTestContainer> {
  const container = await new RedisContainer('redis:7-alpine').start();

  process.env.DB_KIND = 'redis';
  process.env.REDIS_HOST = container.getHost();
  process.env.REDIS_PORT = String(container.getPort());
  process.env.REDIS_PASSWORD = '';

  return container;
}

/** Tolerates a failed startup so the real error is what the suite reports. */
export async function stopShopApp(testApp?: ShopTestApp): Promise<void> {
  if (!testApp) {
    return;
  }
  await testApp.app.close();
  await testApp.container.stop();
}

/** Decodes the payload of a JWT without verifying it. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

let usernameCounter = 0;

/** Tests share one database, so every account needs its own username. */
export function uniqueUsername(prefix: string): string {
  usernameCounter += 1;
  return `${prefix}-${usernameCounter}`;
}

/** The HTTP server of a booted test app, as supertest wants it. */
export type TestServer = ReturnType<INestApplication<App>['getHttpServer']>;

export interface TestSession {
  accessToken: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    walletAddress: string | null;
  };
}

const TEST_PASSWORD = 'sup3r-secret';

export async function signIn(
  server: TestServer,
  username: string,
  password: string,
): Promise<TestSession> {
  const response = await request(server)
    .post(`/${API_PREFIX}/auth/login`)
    .send({ username, password })
    .expect(200);

  return response.body as TestSession;
}

/** Signs in as the admin the AdminSeeder provisioned for the test shop. */
export function signInAsAdmin(server: TestServer): Promise<TestSession> {
  return signIn(server, SEEDED_ADMIN.username, SEEDED_ADMIN.password);
}

/** Registers a fresh customer and returns their signed-in session. */
export async function signInAsCustomer(
  server: TestServer,
  prefix = 'buyer',
): Promise<TestSession> {
  const username = uniqueUsername(prefix);

  await request(server)
    .post(`/${API_PREFIX}/auth/register`)
    .send({ username, displayName: 'Buyer One', password: TEST_PASSWORD })
    .expect(201);

  return signIn(server, username, TEST_PASSWORD);
}
