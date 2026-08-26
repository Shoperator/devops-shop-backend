import { UserRole } from '../../users/entities/user.entity';

/** Claims carried by the access token. */
export interface JwtPayload {
  /** User id. */
  sub: string;
  username: string;
  role: UserRole;
}

/** What the JWT strategy puts on the request after a token is validated. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}
