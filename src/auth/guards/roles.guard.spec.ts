import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity';
import { AuthenticatedUser } from '../types/jwt-payload';
import { RolesGuard } from './roles.guard';

function contextWith(user?: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const admin: AuthenticatedUser = {
  id: 'b3f1c0de-0000-4000-8000-000000000002',
  username: 'admin',
  role: UserRole.ADMIN,
};

const customer: AuthenticatedUser = {
  id: 'b3f1c0de-0000-4000-8000-000000000001',
  username: 'buyer',
  role: UserRole.CUSTOMER,
};

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function requireRoles(roles: UserRole[] | undefined): void {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  }

  it('allows a route that declares no roles', () => {
    requireRoles(undefined);

    expect(guard.canActivate(contextWith(customer))).toBe(true);
  });

  it('allows a user whose role is required', () => {
    requireRoles([UserRole.ADMIN]);

    expect(guard.canActivate(contextWith(admin))).toBe(true);
  });

  it('blocks a customer from an admin-only route', () => {
    requireRoles([UserRole.ADMIN]);

    expect(() => guard.canActivate(contextWith(customer))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks an unauthenticated request', () => {
    requireRoles([UserRole.CUSTOMER]);

    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
