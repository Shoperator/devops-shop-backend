import { ConfigService } from '@nestjs/config';
import type { JwtSignOptions } from '@nestjs/jwt';

/**
 * The signing secret is injected per deployment. Failing fast beats starting a
 * shop that hands out tokens signed with a guessable default.
 */
export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error('JWT_SECRET must be set');
  }
  return secret;
}

/**
 * A duration string such as `1h` or `30m`. Environment values are plain strings,
 * so the narrower type jsonwebtoken expects has to be asserted here.
 */
export function getJwtExpiresIn(
  config: ConfigService,
): JwtSignOptions['expiresIn'] {
  return config.get<string>(
    'JWT_EXPIRES_IN',
    '1h',
  ) as JwtSignOptions['expiresIn'];
}
