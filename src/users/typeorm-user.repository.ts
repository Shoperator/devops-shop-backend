import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { NewUser, UserRepository, UsernameTakenError } from './user.repository';

/** PostgreSQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
  );
}

/** Users in PostgreSQL, for shops deployed with `database: postgresql`. */
@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.users.findOne({ where: { username } });
  }

  existsByUsername(username: string): Promise<boolean> {
    return this.users.existsBy({ username });
  }

  create(data: NewUser): User {
    return this.users.create(data);
  }

  async save(user: User): Promise<User> {
    try {
      return await this.users.save(user);
    } catch (error) {
      // The unique index on `username` is what settles two registrations that
      // raced each other; the driver's error is translated here so the service
      // never has to know which database rejected it.
      if (isUniqueViolation(error)) {
        throw new UsernameTakenError(user.username);
      }
      throw error;
    }
  }
}
