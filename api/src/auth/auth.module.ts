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
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // Sin secreto aquí: cada firma/verificación pasa el suyo (access o refresh).
    JwtModule.register({}),
    // Dos throttlers con nombre, y cada ruta salta el que no es suyo:
    // - `login`: 5/min por IP, sólo `POST /auth/login`. La IP es `req.ip`; detrás
    //   del proxy del VPS hará falta `trust proxy` (pendiente de deploy).
    // - `agente`: 120/min por sucursal, las rutas `@AutenticacionAgente()` (F1-012).
    // Storage en memoria: vale por proceso.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'login', ttl: 60_000, limit: 5 }, OPCIONES_THROTTLER_AGENTE],
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
