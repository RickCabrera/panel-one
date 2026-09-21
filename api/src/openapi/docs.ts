import { createHash, timingSafeEqual } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

import { construirDocumento } from './documento';

/** Swagger UI. El JSON vive DENTRO del mismo prefijo, así lo cubre la misma protección. */
export const RUTA_DOCS = '/docs';
export const RUTA_DOCS_JSON = '/docs/openapi.json';

const LONGITUD_MINIMA_PASSWORD = 16;

export interface DocsConfig {
  usuario: string;
  password: string;
}

/**
 * `/docs` protegido (F1-033) con HTTP Basic: `DOCS_USUARIO` y `DOCS_PASSWORD`.
 *
 * - Sin las DOS variables, `/docs` no se monta (404): cerrado por defecto, nunca
 *   abierto "porque faltó configurar".
 * - Con sólo una, o con una contraseña corta, el arranque truena, igual que con
 *   los secretos JWT: una config a medias es un error, no un "sin docs".
 *
 * Por qué Basic y no el JWT: el navegador no manda un Bearer al abrir `/docs`,
 * y los guards de Nest no corren en las rutas de Swagger (son Express crudo).
 */
export function leerDocsConfig(entorno: NodeJS.ProcessEnv = process.env): DocsConfig | null {
  const usuario = entorno.DOCS_USUARIO;
  const password = entorno.DOCS_PASSWORD;
  if (!usuario && !password) {
    return null;
  }
  if (!usuario || !password) {
    throw new Error('DOCS_USUARIO y DOCS_PASSWORD van juntos: define las dos o ninguna.');
  }
  if (password.length < LONGITUD_MINIMA_PASSWORD) {
    throw new Error(`DOCS_PASSWORD debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`);
  }
  return { usuario, password };
}

/** Compara en tiempo constante: los dos lados se reducen a SHA-256 del mismo largo. */
function iguales(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

function credencialesValidas(cabecera: string | undefined, config: DocsConfig): boolean {
  if (!cabecera) {
    return false;
  }
  const [tipo, valor, ...resto] = cabecera.split(' ');
  if (tipo !== 'Basic' || !valor || resto.length > 0) {
    return false;
  }
  const texto = Buffer.from(valor, 'base64').toString('utf8');
  const i = texto.indexOf(':');
  if (i < 0) {
    return false;
  }
  // Las dos comparaciones siempre corren: no se corta en la primera que falla.
  const usuarioOk = iguales(texto.slice(0, i), config.usuario);
  const passwordOk = iguales(texto.slice(i + 1), config.password);
  return usuarioOk && passwordOk;
}

/** Monta Swagger UI en `/docs` detrás de Basic, o nada si no hay config. */
export function montarDocs(app: INestApplication, config: DocsConfig | null): void {
  if (config === null) {
    return;
  }
  // Antes que Swagger: todo lo que cuelga de /docs pasa por aquí.
  app.use(RUTA_DOCS, (req: Request, res: Response, next: NextFunction) => {
    if (credencialesValidas(req.headers.authorization, config)) {
      next();
      return;
    }
    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="docs", charset="UTF-8"')
      .set('Cache-Control', 'no-store')
      .json({ statusCode: 401, message: 'No autenticado', error: 'Unauthorized' });
  });
  SwaggerModule.setup(RUTA_DOCS.slice(1), app, construirDocumento(app), {
    // Sólo JSON, y dentro de /docs: no existe /docs-json ni /docs-yaml.
    raw: ['json'],
    jsonDocumentUrl: RUTA_DOCS_JSON.slice(1),
  });
}
