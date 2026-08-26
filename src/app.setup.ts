import { INestApplication, ValidationPipe } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

/**
 * Everything the HTTP layer needs, shared by the real bootstrap and the
 * integration tests so both exercise the same request pipeline.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown properties are rejected outright, so a request cannot smuggle
      // in fields the DTO does not declare (for example `role`).
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
