import { Injectable } from '@nestjs/common';
import { UserRepository } from './user.repository';

/**
 * Shop users: the admin managing the catalogue and the customers buying from it.
 * Behaviour is added in the follow-up commits of this PR.
 */
@Injectable()
export class UsersService {
  constructor(private readonly userRepository: UserRepository) {}
}
