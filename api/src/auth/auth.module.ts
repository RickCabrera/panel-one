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
import { OPCIONES_THROTTLER_LOGIN, OPCIONES_THROTTLER_REFRESH } from './throttlers';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // Sin secreto aquí: cada firma/verificación pasa el suyo (access o refresh).
    JwtModule.register({}),
    // Tres throttlers con nombre, y cada ruta salta los que no son suyos:
    // - `login`: 5/min por IP, `POST /auth/login` y `POST /cuenta/password`.
    // - `refresh`: 30/min por IP, `POST /auth/refresh` (F1-092) y `POST /auth/logout` (F1-093).
    // - `agente`: 120/min por sucursal, las rutas `@AutenticacionAgente()` (F1-012).
    // La IP es `req.ip`: detrás de Caddy sale de `TRUST_PROXY_SALTOS` (configurarApp).
    // Storage en memoria: vale por proceso.
    ThrottlerModule.forRoot({
      throttlers: [OPCIONES_THROTTLER_LOGIN, OPCIONES_THROTTLER_REFRESH, OPCIONES_THROTTLER_AGENTE],
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
