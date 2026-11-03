import { Global, Module, type Provider } from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import {
  ArchivosDisco,
  RAIZ_ARCHIVOS_FALSO,
  SECRETO_ARCHIVOS_FALSO,
  URL_BASE_ARCHIVOS_FALSO,
} from './archivos/archivos-disco';
import type { PuertoArchivos } from './archivos/puerto';
import { leerAdaptadoresConfig, type AdaptadoresConfig } from './config';
import { CorreoBrevo } from './correo/correo-brevo';
import {
  BANDEJA_CORREO_FALSO,
  CorreoFalso,
  DIRECTORIO_CORREO_FALSO,
  PROVEEDOR_BANDEJA_CORREO_FALSO,
  type BandejaCorreoFalso,
} from './correo/correo-falso';
import type { PuertoCorreo } from './correo/puerto';
import { ClienteFetch } from './http';
import { DIRECTORIO_PUSH_FALSO, PushFalso } from './push/push-falso';
import { PushWebPush } from './push/push-webpush';
import type { PuertoPush } from './push/puerto';
import type { PuertoTimbrado } from './timbrado/puerto';
import { TimbradoFacturama } from './timbrado/timbrado-facturama';
import { TimbradoFalso } from './timbrado/timbrado-falso';
import { TimbradoNoConectado } from './timbrado/timbrado-no-conectado';

/**
 * Tokens de los puertos externos (F2-202). Un servicio de negocio inyecta el TOKEN y
 * tipa con la interfaz del puerto; nunca importa una implementación. Cambiar
 * `PAC_IMPL`, `CORREO_IMPL` o `ARCHIVOS_IMPL` cambia lo que resuelve el token, y nada
 * más.
 */
export const ADAPTADORES_CONFIG = Symbol('ADAPTADORES_CONFIG');
export const PUERTO_TIMBRADO = Symbol('PUERTO_TIMBRADO');
export const PUERTO_CORREO = Symbol('PUERTO_CORREO');
export const PUERTO_ARCHIVOS = Symbol('PUERTO_ARCHIVOS');
export const PUERTO_PUSH = Symbol('PUERTO_PUSH');
/**
 * `true` = producción SIN PAC (`PAC_IMPL=falso` permitido en producción): las rutas que timbran
 * responden 503 con un mensaje claro (`PacConectadoGuard`) y el puerto nunca simula.
 */
export const PAC_NO_CONECTADO = Symbol('PAC_NO_CONECTADO');

export function pacNoConectado(
  config: AdaptadoresConfig,
  entorno: NodeJS.ProcessEnv = process.env,
): boolean {
  return entorno.NODE_ENV === 'production' && config.pac.impl === 'falso';
}

export function crearTimbrado(
  config: AdaptadoresConfig,
  reloj: Reloj,
  entorno: NodeJS.ProcessEnv = process.env,
): PuertoTimbrado {
  const pac = config.pac;
  if (pac.impl === 'facturama') {
    const basic = Buffer.from(`${pac.usuario}:${pac.password}`).toString('base64');
    return new TimbradoFacturama(
      pac.url,
      new ClienteFetch({ Authorization: `Basic ${basic}` }),
      reloj,
    );
  }
  // En producción el falso NO simula: facturas inventadas no existen ante el SAT.
  if (pacNoConectado(config, entorno)) return new TimbradoNoConectado();
  return new TimbradoFalso(reloj);
}

export function crearCorreo(
  config: AdaptadoresConfig,
  bandeja: BandejaCorreoFalso,
  reloj: Reloj,
): PuertoCorreo {
  const correo = config.correo;
  if (correo.impl === 'brevo') {
    return new CorreoBrevo(correo.remitente, new ClienteFetch({ 'api-key': correo.apiKey }));
  }
  return new CorreoFalso(bandeja, reloj, correo.directorio ?? DIRECTORIO_CORREO_FALSO);
}

export function crearArchivos(config: AdaptadoresConfig, reloj: Reloj): PuertoArchivos {
  const a = config.archivos;
  if (a.impl === 'disco') return new ArchivosDisco(a.raiz, a.secreto, a.urlBase, reloj);
  return new ArchivosDisco(
    a.raiz ?? RAIZ_ARCHIVOS_FALSO,
    SECRETO_ARCHIVOS_FALSO,
    URL_BASE_ARCHIVOS_FALSO,
    reloj,
  );
}

export function crearPush(config: AdaptadoresConfig, reloj: Reloj): PuertoPush {
  const push = config.push;
  if (push.impl === 'webpush') return new PushWebPush(push.vapid, push.hostsExtra);
  return new PushFalso(
    push.vapid?.publica ?? null,
    reloj,
    push.directorio ?? (config.modoDemo ? DIRECTORIO_PUSH_FALSO : undefined),
  );
}

const PROVEEDORES: Provider[] = [
  // Se lee al crear la app: una combinación prohibida (producción + falso) o una
  // credencial faltante TRUENA aquí y el arranque aborta.
  { provide: ADAPTADORES_CONFIG, useFactory: () => leerAdaptadoresConfig() },
  {
    provide: PUERTO_TIMBRADO,
    useFactory: (config: AdaptadoresConfig, reloj: Reloj) => crearTimbrado(config, reloj),
    inject: [ADAPTADORES_CONFIG, Reloj],
  },
  {
    provide: PAC_NO_CONECTADO,
    useFactory: (config: AdaptadoresConfig) => pacNoConectado(config),
    inject: [ADAPTADORES_CONFIG],
  },
  PROVEEDOR_BANDEJA_CORREO_FALSO,
  {
    provide: PUERTO_CORREO,
    useFactory: crearCorreo,
    inject: [ADAPTADORES_CONFIG, BANDEJA_CORREO_FALSO, Reloj],
  },
  { provide: PUERTO_ARCHIVOS, useFactory: crearArchivos, inject: [ADAPTADORES_CONFIG, Reloj] },
  { provide: PUERTO_PUSH, useFactory: crearPush, inject: [ADAPTADORES_CONFIG, Reloj] },
];

@Global()
@Module({
  providers: PROVEEDORES,
  exports: [
    ADAPTADORES_CONFIG,
    PUERTO_TIMBRADO,
    PAC_NO_CONECTADO,
    PUERTO_CORREO,
    PUERTO_ARCHIVOS,
    PUERTO_PUSH,
  ],
})
export class AdaptadoresModule {}
