import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { User, UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

const PASSWORD = 'sup3r-secret';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: {
    findByUsername: jest.Mock;
    createCustomer: jest.Mock;
    getById: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let customer: User;

  beforeAll(async () => {
    customer = {
      id: 'b3f1c0de-0000-4000-8000-000000000001',
      username: 'buyer',
      displayName: 'Buyer One',
      // Cheap rounds keep the suite fast; production hashing uses the default.
      passwordHash: await hash(PASSWORD, 4),
      role: UserRole.CUSTOMER,
      walletAddress: null,
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    };
  });

  beforeEach(async () => {
    usersService = {
      findByUsername: jest.fn(),
      createCustomer: jest.fn(),
      getById: jest.fn(),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('returns a bearer token for valid credentials', async () => {
      usersService.findByUsername.mockResolvedValue(customer);

      const result = await authService.login({
        username: 'buyer',
        password: PASSWORD,
      });

      expect(result).toEqual({
        accessToken: 'signed-token',
        tokenType: 'Bearer',
        user: {
          id: customer.id,
          username: 'buyer',
          displayName: 'Buyer One',
          role: UserRole.CUSTOMER,
          walletAddress: null,
        },
      });
    });

    it('signs the user id and role into the token', async () => {
      usersService.findByUsername.mockResolvedValue(customer);

      await authService.login({ username: 'buyer', password: PASSWORD });

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: customer.id,
        username: 'buyer',
        role: UserRole.CUSTOMER,
      });
    });

    it('never leaks the password hash', async () => {
      usersService.findByUsername.mockResolvedValue(customer);

      const result = await authService.login({
        username: 'buyer',
        password: PASSWORD,
      });

      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('rejects an unknown username', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'ghost', password: PASSWORD }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      usersService.findByUsername.mockResolvedValue(customer);

      await expect(
        authService.login({ username: 'buyer', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reports the same message whether the username or the password is wrong', async () => {
      usersService.findByUsername.mockResolvedValueOnce(null);
      const unknownUser = await authService
        .login({ username: 'ghost', password: PASSWORD })
        .catch((error: Error) => error.message);

      usersService.findByUsername.mockResolvedValueOnce(customer);
      const wrongPassword = await authService
        .login({ username: 'buyer', password: 'wrong-password' })
        .catch((error: Error) => error.message);

      expect(unknownUser).toBe(wrongPassword);
    });
  });

  describe('register', () => {
    it('creates a customer and returns only public fields', async () => {
      usersService.createCustomer.mockResolvedValue(customer);

      const result = await authService.register({
        username: 'buyer',
        displayName: 'Buyer One',
        password: PASSWORD,
      });

      expect(usersService.createCustomer).toHaveBeenCalledWith({
        username: 'buyer',
        displayName: 'Buyer One',
        password: PASSWORD,
      });
      expect(result).toEqual({
        id: customer.id,
        username: 'buyer',
        displayName: 'Buyer One',
        role: UserRole.CUSTOMER,
        walletAddress: null,
      });
    });
  });
});
