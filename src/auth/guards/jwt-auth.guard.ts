import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid `Authorization: Bearer <token>` header. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
