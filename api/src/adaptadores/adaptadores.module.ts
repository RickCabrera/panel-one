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
import type { PuertoTimbrado } from './timbrado/puerto';
import { TimbradoFacturama } from './timbrado/timbrado-facturama';
import { TimbradoFalso } from './timbrado/timbrado-falso';

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

export function crearTimbrado(config: AdaptadoresConfig, reloj: Reloj): PuertoTimbrado {
  const pac = config.pac;
  if (pac.impl === 'facturama') {
    const basic = Buffer.from(`${pac.usuario}:${pac.password}`).toString('base64');
    return new TimbradoFacturama(
      pac.url,
      new ClienteFetch({ Authorization: `Basic ${basic}` }),
      reloj,
    );
  }
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

const PROVEEDORES: Provider[] = [
  // Se lee al crear la app: una combinación prohibida (producción + falso) o una
  // credencial faltante TRUENA aquí y el arranque aborta.
  { provide: ADAPTADORES_CONFIG, useFactory: () => leerAdaptadoresConfig() },
  { provide: PUERTO_TIMBRADO, useFactory: crearTimbrado, inject: [ADAPTADORES_CONFIG, Reloj] },
  PROVEEDOR_BANDEJA_CORREO_FALSO,
  {
    provide: PUERTO_CORREO,
    useFactory: crearCorreo,
    inject: [ADAPTADORES_CONFIG, BANDEJA_CORREO_FALSO, Reloj],
  },
  { provide: PUERTO_ARCHIVOS, useFactory: crearArchivos, inject: [ADAPTADORES_CONFIG, Reloj] },
];

@Global()
@Module({
  providers: PROVEEDORES,
  exports: [ADAPTADORES_CONFIG, PUERTO_TIMBRADO, PUERTO_CORREO, PUERTO_ARCHIVOS],
})
export class AdaptadoresModule {}
