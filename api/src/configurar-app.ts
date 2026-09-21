import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * Lo que se le monta a la app además de los módulos. Lo usan `main.ts` y los
 * tests e2e, para que lo probado sea exactamente lo que corre.
 */
export function configurarApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  return app;
}
