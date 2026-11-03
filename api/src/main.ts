// Primero que todo: vuelca api/.env a process.env antes de que se lea una sola
// variable (F2-200). Lo que ya esté en el entorno gana.
import { cargarEnvLocal } from './config/cargar-env';
cargarEnvLocal();

import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { falsosEnProduccion } from './adaptadores/config';
import { AppModule } from './app.module';
import { validarEntornoProduccion } from './config/produccion.config';
import { configurarApp } from './configurar-app';
import { leerDocsConfig, montarDocs } from './openapi/docs';

async function bootstrap(): Promise<void> {
  // Con NODE_ENV=production, TODOS los problemas del entorno juntos y antes de crear
  // nada (secretos de relleno, obligatorias faltantes). Fuera de producción no hace nada.
  const avisos = validarEntornoProduccion();
  const log = new Logger('Arranque');
  for (const aviso of avisos) log.warn(aviso);
  for (const variable of falsosEnProduccion()) {
    log.warn(`${variable}=falso en PRODUCCIÓN (PERMITIR_FALSOS_EN_PRODUCCION): no sale a la red.`);
  }

  const app = configurarApp(await NestFactory.create<NestExpressApplication>(AppModule));
  // `/docs` sólo con DOCS_USUARIO/DOCS_PASSWORD (Basic); sin ellas no se monta.
  montarDocs(app, leerDocsConfig());
  // Railway (y cualquier contenedor) inyecta PORT. Sin host, Node escucha en `::` (IPv4 e
  // IPv6) si el sistema tiene IPv6: el servicio web llega por la red privada de Railway
  // (api.railway.internal), que resuelve a IPv6.
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
