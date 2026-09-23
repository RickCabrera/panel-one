import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { raw, type NextFunction, type Request, type Response } from 'express';

import { leerTrustProxy } from './config/proxy.config';

/**
 * Tope del body JSON, para TODAS las rutas (login incluido). El default de
 * Express (100 KB) no alcanza para un lote de ingesta de 100 cheques con sus
 * partidas (F1-031). Un body con `Content-Encoding: gzip` (F1-024) lo infla
 * body-parser solo, y el tope se mide sobre el tamaño YA inflado: un gzip
 * pequeño que infla a más de esto es 413, no memoria agotada.
 */
export const LIMITE_BODY_JSON = '5mb';

/** F2-143: la única ruta con cuerpo crudo (el `agente.exe` que publica el admin_global). */
export const RUTA_PUBLICAR_BINARIO = '/agente/versiones';
/** Mismo tope que `TAMANO_MAXIMO_BINARIO` (actualizacion-agente.service.ts). */
export const LIMITE_BINARIO_AGENTE = '128mb';

/**
 * Cabeceras de seguridad de TODA respuesta de la API (F1-092). Sin helmet: son
 * cuatro y no hace falta una dependencia. `no-store` porque lo que sale de aquí son
 * ventas y datos de una empresa: no se quedan en la caché del navegador ni en una
 * compartida. HSTS y la CSP de la SPA las pone Caddy (`infra/caddy/seguridad.caddy`).
 */
export const CABECERAS_SEGURIDAD: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function cabecerasSeguridad(_req: Request, res: Response, siguiente: NextFunction): void {
  for (const [nombre, valor] of Object.entries(CABECERAS_SEGURIDAD)) res.setHeader(nombre, valor);
  siguiente();
}

/**
 * Lo que se le monta a la app además de los módulos. Lo usan `main.ts` y los
 * tests e2e, para que lo probado sea exactamente lo que corre.
 */
export function configurarApp(
  app: NestExpressApplication,
  entorno: NodeJS.ProcessEnv = process.env,
): NestExpressApplication {
  // `req.ip` (y con él los rate limits por IP) según los proxies de confianza.
  app.set('trust proxy', leerTrustProxy(entorno));
  app.disable('x-powered-by');
  app.use(cabecerasSeguridad);
  app.useBodyParser('json', { limit: LIMITE_BODY_JSON });
  // F2-143: publicar un binario del agente. SÓLO esa ruta acepta un cuerpo crudo, y hasta
  // `LIMITE_BINARIO_AGENTE`; el resto de la API sigue con el JSON de 5 MB.
  app.use(
    RUTA_PUBLICAR_BINARIO,
    raw({ type: 'application/octet-stream', limit: LIMITE_BINARIO_AGENTE }),
  );
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  return app;
}
