import request from 'supertest';
import { UserRole } from '../src/users/entities/user.entity';
import {
  decodeJwtPayload,
  SEEDED_ADMIN,
  ShopTestApp,
  startShopApp,
  stopShopApp,
  uniqueUsername,
} from './shop-app';

const PASSWORD = 'sup3r-secret';
const AUTH = '/api/v1/auth';

interface UserResponse {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  walletAddress: string | null;
}

interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: UserResponse;
}

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
}

describe('Auth (e2e)', () => {
  let testApp: ShopTestApp;
  let server: ReturnType<ShopTestApp['app']['getHttpServer']>;

  beforeAll(async () => {
    testApp = await startShopApp();
    server = testApp.app.getHttpServer();
  }, 180_000);

  afterAll(async () => {
    await stopShopApp(testApp);
  });

  async function registerCustomer(prefix = 'buyer'): Promise<UserResponse> {
    const response = await request(server)
      .post(`${AUTH}/register`)
      .send({
        username: uniqueUsername(prefix),
        displayName: 'Buyer One',
        password: PASSWORD,
      })
      .expect(201);

    return response.body as UserResponse;
  }

  async function login(
    username: string,
    password: string,
  ): Promise<AuthResponse> {
    const response = await request(server)
      .post(`${AUTH}/login`)
      .send({ username, password })
      .expect(200);

    return response.body as AuthResponse;
  }

  async function registerAndLogin(prefix = 'buyer'): Promise<AuthResponse> {
    const user = await registerCustomer(prefix);
    return login(user.username, PASSWORD);
  }

  describe('POST /auth/register', () => {
    it('creates a customer account', async () => {
      const user = await registerCustomer();

      expect(user).toEqual({
        id: expect.any(String) as string,
        username: user.username,
        displayName: 'Buyer One',
        role: UserRole.CUSTOMER,
        walletAddress: null,
      });
    });

    it('never returns the password hash', async () => {
      const user = await registerCustomer();

      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('password');
    });

    it('refuses a self-assigned admin role', async () => {
      // The DTO has no `role`, and forbidNonWhitelisted rejects the request
      // instead of silently dropping the field.
      const response = await request(server)
        .post(`${AUTH}/register`)
        .send({
          username: uniqueUsername('sneaky'),
          displayName: 'Sneaky',
          password: PASSWORD,
          role: UserRole.ADMIN,
        })
        .expect(400);

      const error = response.body as ErrorResponse;
      expect(JSON.stringify(error.message)).toContain('role');
    });

    it('rejects a duplicate username', async () => {
      const account = {
        username: uniqueUsername('twin'),
        displayName: 'First',
        password: PASSWORD,
      };

      await request(server).post(`${AUTH}/register`).send(account).expect(201);
      await request(server).post(`${AUTH}/register`).send(account).expect(409);
    });

    it('rejects a password shorter than eight characters', async () => {
      await request(server)
        .post(`${AUTH}/register`)
        .send({
          username: uniqueUsername('short'),
          displayName: 'Short Pass',
          password: 'abc',
        })
        .expect(400);
    });

    it('rejects a username with illegal characters', async () => {
      await request(server)
        .post(`${AUTH}/register`)
        .send({
          username: 'not a username!',
          displayName: 'Odd Name',
          password: PASSWORD,
        })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a bearer token and the public profile', async () => {
      const session = await registerAndLogin();

      expect(session.tokenType).toBe('Bearer');
      expect(typeof session.accessToken).toBe('string');
      expect(session.user).toEqual({
        id: expect.any(String) as string,
        username: session.user.username,
        displayName: 'Buyer One',
        role: UserRole.CUSTOMER,
        walletAddress: null,
      });
    });

    it('signs the user id and role into the token', async () => {
      const session = await registerAndLogin();

      expect(decodeJwtPayload(session.accessToken)).toMatchObject({
        sub: session.user.id,
        username: session.user.username,
        role: UserRole.CUSTOMER,
      });
    });

    it('rejects a wrong password', async () => {
      const session = await registerAndLogin();

      await request(server)
        .post(`${AUTH}/login`)
        .send({ username: session.user.username, password: 'wrong-password' })
        .expect(401);
    });

    it('does not reveal whether a username exists', async () => {
      const session = await registerAndLogin();

      const unknownUser = await request(server)
        .post(`${AUTH}/login`)
        .send({ username: 'no-such-user', password: PASSWORD })
        .expect(401);

      const wrongPassword = await request(server)
        .post(`${AUTH}/login`)
        .send({ username: session.user.username, password: 'wrong-password' })
        .expect(401);

      expect((unknownUser.body as ErrorResponse).message).toBe(
        (wrongPassword.body as ErrorResponse).message,
      );
    });
  });

  describe('GET /auth/me', () => {
    it('returns the profile the token belongs to', async () => {
      const session = await registerAndLogin();

      const response = await request(server)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      expect(response.body as UserResponse).toEqual(session.user);
    });

    it('rejects a request without a token', async () => {
      await request(server).get(`${AUTH}/me`).expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(server)
        .get(`${AUTH}/me`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('rejects a token signed with another secret', async () => {
      // header.payload.signature, claiming the ADMIN role.
      const forged = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJ1c2VybmFtZSI6ImhhY2tlciIsInJvbGUiOiJBRE1JTiJ9',
        'this-signature-was-not-made-with-our-secret',
      ].join('.');

      await request(server)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  describe('seeded shop admin', () => {
    it('can sign in and carries the ADMIN role', async () => {
      const session = await login(SEEDED_ADMIN.username, SEEDED_ADMIN.password);

      expect(session.user).toMatchObject({
        username: SEEDED_ADMIN.username,
        displayName: SEEDED_ADMIN.displayName,
        role: UserRole.ADMIN,
      });
      expect(decodeJwtPayload(session.accessToken)).toMatchObject({
        role: UserRole.ADMIN,
      });
    });
  });
});
