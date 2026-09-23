import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';

import { OPCIONES_THROTTLER_AGENTE } from '../agentes/throttle-agente';
import { AUTH_CONFIG, leerAuthConfig } from '../config/auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CuentaController } from './cuenta.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import {
  OPCIONES_THROTTLER_LOGIN,
  OPCIONES_THROTTLER_LOGIN_HORA,
  OPCIONES_THROTTLER_REFRESH,
  OPCIONES_THROTTLER_RESET,
  OPCIONES_THROTTLER_BAJA,
  OPCIONES_THROTTLER_CODIGO,
  OPCIONES_THROTTLER_FACTURAS_PORTAL,
  OPCIONES_THROTTLER_PORTAL,
} from './throttlers';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // Sin secreto aquí: cada firma/verificación pasa el suyo (access o refresh).
    JwtModule.register({}),
    // Nueve throttlers con nombre, y cada ruta salta los que no son suyos
    // (`SoloThrottlers(...)` de throttlers.ts):
    // - `login`: 5/min por IP, `POST /auth/login` y `POST /cuenta/password`.
    // - `login-hora`: 30/h por IP, las mismas dos rutas (F2-203).
    // - `reset`: 10/min por IP, `POST /usuarios/:id/password` (F2-203).
    // - `baja-reportes`: 10/min por IP, `POST /reportes/baja` (F2-141).
    // - `codigo-facturacion`: 10/min por IP, `GET /facturacion/codigo/:codigo` (F2-101) y la
    //   consulta del código desde el portal (F2-103).
    // - `portal-facturacion`: 60/min por IP, la marca y el logo del portal (F2-103).
    // - `facturas-portal`: 5/min por IP, `POST /facturacion/portal/:slug/facturas` (F2-103).
    // - `refresh`: 30/min por IP, `POST /auth/refresh` (F1-092) y `POST /auth/logout` (F1-093).
    // - `agente`: 120/min por sucursal, las rutas `@AutenticacionAgente()` (F1-012).
    // La IP es `req.ip`: detrás de Caddy sale de `TRUST_PROXY_SALTOS` (configurarApp).
    // Storage en memoria: vale por proceso.
    ThrottlerModule.forRoot({
      throttlers: [
        OPCIONES_THROTTLER_LOGIN,
        OPCIONES_THROTTLER_LOGIN_HORA,
        OPCIONES_THROTTLER_REFRESH,
        OPCIONES_THROTTLER_RESET,
        OPCIONES_THROTTLER_BAJA,
        OPCIONES_THROTTLER_CODIGO,
        OPCIONES_THROTTLER_PORTAL,
        OPCIONES_THROTTLER_FACTURAS_PORTAL,
        OPCIONES_THROTTLER_AGENTE,
      ],
    }),
  ],
  controllers: [AuthController, CuentaController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => leerAuthConfig() },
    AuthService,
    TokensService,
    // Globales, en este orden: primero quién eres (y tu scope), luego tu rol.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
