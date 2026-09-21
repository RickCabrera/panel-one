import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/**
 * Tope del body JSON, para TODAS las rutas (login incluido). El default de
 * Express (100 KB) no alcanza para un lote de ingesta de 100 cheques con sus
 * partidas (F1-031). Un body con `Content-Encoding: gzip` (F1-024) lo infla
 * body-parser solo, y el tope se mide sobre el tamaño YA inflado: un gzip
 * pequeño que infla a más de esto es 413, no memoria agotada.
 */
export const LIMITE_BODY_JSON = '5mb';

/**
 * Lo que se le monta a la app además de los módulos. Lo usan `main.ts` y los
 * tests e2e, para que lo probado sea exactamente lo que corre.
 */
export function configurarApp(app: NestExpressApplication): NestExpressApplication {
  app.useBodyParser('json', { limit: LIMITE_BODY_JSON });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  return app;
}
