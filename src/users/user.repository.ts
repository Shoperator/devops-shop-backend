import { User, UserRole } from './entities/user.entity';

/** Injection token for the user store. See {@link ArticleRepository}. */
export const USER_REPOSITORY = 'USER_REPOSITORY';

/**
 * Raised by `save` when the username is already taken.
 *
 * Usernames are unique, and two registrations racing each other both pass a
 * prior existence check — so the store is the only place that can settle it.
 * How it does that differs (a unique index in PostgreSQL, a set-if-absent in
 * Redis), and this error is what the two have in common.
 */
export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super(`Username "${username}" is already taken`);
    this.name = 'UsernameTakenError';
  }
}

/** The fields a new user is created from; the store fills in the rest. */
export interface NewUser {
  username: string;
  displayName: string;
  passwordHash: string;
  walletAddress: string | null;
  role: UserRole;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;

  findByUsername(username: string): Promise<User | null>;

  existsByUsername(username: string): Promise<boolean>;

  /** Builds an unsaved user. The id and timestamps appear on save. */
  create(data: NewUser): User;

  /** @throws UsernameTakenError when the username was claimed meanwhile. */
  save(user: User): Promise<User>;
}
