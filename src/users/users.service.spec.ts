import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { compare } from 'bcryptjs';
import { User, UserRole } from './entities/user.entity';
import { USER_REPOSITORY, UsernameTakenError } from './user.repository';
import { UsersService } from './users.service';

const PASSWORD = 'sup3r-secret';

const registration = {
  username: 'buyer',
  displayName: 'Buyer One',
  password: PASSWORD,
};

describe('UsersService', () => {
  let usersService: UsersService;
  let userRepository: {
    existsByUsername: jest.Mock;
    findByUsername: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    userRepository = {
      existsByUsername: jest.fn().mockResolvedValue(false),
      findByUsername: jest.fn(),
      findById: jest.fn(),
      create: jest.fn((data: Partial<User>) => data as User),
      save: jest.fn((user: User) => Promise.resolve(user)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: USER_REPOSITORY, useValue: userRepository },
      ],
    }).compile();

    usersService = moduleRef.get(UsersService);
  });

  describe('createCustomer', () => {
    it('stores the password as a bcrypt hash, never in plain text', async () => {
      const user = await usersService.createCustomer(registration);

      expect(user.passwordHash).not.toBe(PASSWORD);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
      await expect(compare(PASSWORD, user.passwordHash)).resolves.toBe(true);
    });

    it('assigns the customer role, never admin', async () => {
      const user = await usersService.createCustomer(registration);

      expect(user.role).toBe(UserRole.CUSTOMER);
    });

    it('defaults the wallet address to null', async () => {
      const user = await usersService.createCustomer(registration);

      expect(user.walletAddress).toBeNull();
    });

    it('rejects a username that is already taken', async () => {
      userRepository.existsByUsername.mockResolvedValue(true);

      await expect(
        usersService.createCustomer(registration),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('turns a taken username into a conflict, not a 500', async () => {
      // Two simultaneous registrations both pass the existsByUsername check and
      // only the store catches the duplicate — a unique index in PostgreSQL, a
      // set-if-absent in Redis, the same error either way.
      userRepository.save.mockRejectedValue(
        new UsernameTakenError(registration.username),
      );

      await expect(
        usersService.createCustomer(registration),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets an unrelated database error surface', async () => {
      userRepository.save.mockRejectedValue(new Error('connection lost'));

      await expect(usersService.createCustomer(registration)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('create', () => {
    it('provisions an admin when asked for one', async () => {
      const user = await usersService.create(registration, UserRole.ADMIN);

      expect(user.role).toBe(UserRole.ADMIN);
    });
  });

  describe('getById', () => {
    it('returns the user', async () => {
      const stored = { id: 'user-id' } as User;
      userRepository.findById.mockResolvedValue(stored);

      await expect(usersService.getById('user-id')).resolves.toBe(stored);
    });

    it('throws when the user is gone', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(usersService.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
