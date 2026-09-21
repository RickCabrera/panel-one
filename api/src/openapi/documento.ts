import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { AppModule } from '../app.module';
import { COOKIE_REFRESH } from '../config/auth.config';

/** El contrato versionado. Lo genera `npm run openapi` y lo vigila `openapi.spec.ts`. */
export const RUTA_OPENAPI = join(__dirname, '..', '..', 'openapi.json');

export function construirDocumento(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Monitor SoftRestaurant API')
    .setDescription(
      'Contrato de la API del monitor. Fuente única: el frontend construye contra este ' +
        'documento. Lo genera `npm run openapi` en /api a partir de los decoradores.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addCookieAuth(COOKIE_REFRESH)
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * El documento de la app real, sin arrancarla: `preview` arma el grafo de
 * módulos sin instanciar providers, así que no pide base ni secretos.
 */
export async function generarDocumento(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  try {
    return construirDocumento(app);
  } finally {
    await app.close();
  }
}

export function serializar(documento: OpenAPIObject): string {
  return JSON.stringify(documento, null, 2) + '\n';
}
