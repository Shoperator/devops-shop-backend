import { Controller } from '@nestjs/common';
import { UsersService } from './users.service';

/** Endpoints are added in the follow-up commits of this PR. */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
}
