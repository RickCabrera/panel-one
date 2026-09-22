// Primero que todo: vuelca api/.env a process.env antes de que se lea una sola
// variable (F2-200). Lo que ya esté en el entorno gana.
import { cargarEnvLocal } from './config/cargar-env';
cargarEnvLocal();

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';
import { leerDocsConfig, montarDocs } from './openapi/docs';

async function bootstrap(): Promise<void> {
  const app = configurarApp(await NestFactory.create<NestExpressApplication>(AppModule));
  // `/docs` sólo con DOCS_USUARIO/DOCS_PASSWORD (Basic); sin ellas no se monta.
  montarDocs(app, leerDocsConfig());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
