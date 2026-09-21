import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';

import { AUTH_CONFIG, leerAuthConfig } from '../config/auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // Sin secreto aquí: cada firma/verificación pasa el suyo (access o refresh).
    JwtModule.register({}),
    // Sólo `POST /auth/login` usa el ThrottlerGuard. Storage en memoria: vale por
    // proceso. La IP es `req.ip`; detrás del proxy del VPS hará falta
    // `trust proxy` (pendiente de deploy, ver docs/nocturno-log.md).
    ThrottlerModule.forRoot({ throttlers: [{ name: 'login', ttl: 60_000, limit: 5 }] }),
  ],
  controllers: [AuthController],
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
