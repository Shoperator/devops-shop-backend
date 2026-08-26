import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole } from './entities/user.entity';
import { UserRepository } from './user.repository';

const PASSWORD_SALT_ROUNDS = 10;

/** PostgreSQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
  );
}

/**
 * Shop users: the admin managing the catalogue and the customers buying from it.
 */
@Injectable()
export class UsersService {
  constructor(private readonly userRepository: UserRepository) {}

  /** Self-registration always creates a customer; admins are provisioned. */
  createCustomer(dto: CreateUserDto): Promise<User> {
    return this.create(dto, UserRole.CUSTOMER);
  }

  async create(dto: CreateUserDto, role: UserRole): Promise<User> {
    if (await this.userRepository.existsByUsername(dto.username)) {
      throw new ConflictException(
        `Username "${dto.username}" is already taken`,
      );
    }

    const user = this.userRepository.create({
      username: dto.username,
      displayName: dto.displayName,
      passwordHash: await hash(dto.password, PASSWORD_SALT_ROUNDS),
      walletAddress: dto.walletAddress ?? null,
      role,
    });

    try {
      return await this.userRepository.save(user);
    } catch (error) {
      // Two registrations for the same username can pass the check above.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Username "${dto.username}" is already taken`,
        );
      }
      throw error;
    }
  }

  findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findByUsername(username);
  }

  async getById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (user === null) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
