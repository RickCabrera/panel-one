import { isAbsolute } from 'node:path';

import { bytesBase64Url, leerHostsExtra } from './push/endpoint';
import type { LlavesVapid } from './push/push-webpush';

/**
 * Qué implementación corre detrás de cada puerto externo (F2-202, regla 1 de la
 * Ronda 2). Se elige SÓLO por variable de entorno: ningún servicio de negocio sabe
 * cuál le tocó, inyecta el token del puerto (`adaptadores.module.ts`).
 *
 * - Sin variable → `falso` (desarrollo y test arrancan sin cuentas de nadie).
 * - Valor desconocido → el arranque TRUENA nombrando la variable. No se adivina.
 * - `NODE_ENV=production` con cualquier puerto en `falso` (puesto o por defecto) →
 *   el arranque TRUENA nombrando cada variable. Un PAC falso en producción son
 *   facturas que el cliente cree timbradas y no existen ante el SAT. Única salida:
 *   nombrar el puerto en `PERMITIR_FALSOS_EN_PRODUCCION` (ver abajo), y el arranque lo avisa.
 * - Las credenciales de una implementación real se exigen sólo si se eligió esa
 *   implementación, y nunca se escriben en un log ni en un mensaje de error.
 */
export const IMPLEMENTACIONES = {
  PAC_IMPL: ['falso', 'facturama'],
  CORREO_IMPL: ['falso', 'brevo'],
  ARCHIVOS_IMPL: ['falso', 'disco'],
  PUSH_IMPL: ['falso', 'webpush'],
} as const;

type VariableImpl = keyof typeof IMPLEMENTACIONES;
export type ImplPac = (typeof IMPLEMENTACIONES.PAC_IMPL)[number];
export type ImplCorreo = (typeof IMPLEMENTACIONES.CORREO_IMPL)[number];
export type ImplArchivos = (typeof IMPLEMENTACIONES.ARCHIVOS_IMPL)[number];
export type ImplPush = (typeof IMPLEMENTACIONES.PUSH_IMPL)[number];

/** Sandbox de Facturama. El productivo (`https://api.facturama.mx`) se pone a mano (F2-190). */
export const FACTURAMA_URL_SANDBOX = 'https://apisandbox.facturama.mx';

export type ConfigPac =
  { impl: 'falso' } | { impl: 'facturama'; url: string; usuario: string; password: string };

export type ConfigCorreo =
  | { impl: 'falso'; directorio: string | undefined }
  | {
      impl: 'brevo';
      apiKey: string;
      remitente: { email: string; nombre: string };
    };

export type ConfigArchivos =
  | { impl: 'falso'; raiz: string | undefined }
  | { impl: 'disco'; raiz: string; secreto: string; urlBase: string };

/**
 * Push (F2-146). Con `falso`, las llaves VAPID son opcionales: si están, la clave pública
 * se expone igual para que un navegador local se pueda suscribir (probar la UI); sin
 * ellas, la clave es null y la web dice que el servidor no tiene notificaciones.
 */
export type ConfigPush =
  | {
      impl: 'falso';
      vapid: LlavesVapid | null;
      directorio: string | undefined;
      hostsExtra: string[];
    }
  | { impl: 'webpush'; vapid: LlavesVapid; hostsExtra: string[] };

export interface AdaptadoresConfig {
  pac: ConfigPac;
  correo: ConfigCorreo;
  archivos: ConfigArchivos;
  push: ConfigPush;
  /** `MODO_DEMO=1`: la interfaz marca todo como "Datos de ejemplo". */
  modoDemo: boolean;
}

const LONGITUD_MINIMA_SECRETO = 32;

function impl<V extends VariableImpl>(
  variable: V,
  entorno: NodeJS.ProcessEnv,
): (typeof IMPLEMENTACIONES)[V][number] {
  const valor = entorno[variable];
  if (valor === undefined || valor === '') return 'falso';
  const validos: readonly string[] = IMPLEMENTACIONES[variable];
  if (!validos.includes(valor)) {
    throw new Error(
      `${variable}="${valor}" no es válido. Valores posibles: ${validos.join(', ')}.`,
    );
  }
  return valor as (typeof IMPLEMENTACIONES)[V][number];
}

function obligatoria(nombre: string, porQue: string, entorno: NodeJS.ProcessEnv): string {
  const valor = entorno[nombre];
  if (!valor) throw new Error(`${nombre} es obligatoria con ${porQue}.`);
  return valor;
}

const VARIABLES_VAPID = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

/**
 * Las llaves VAPID. Obligatorias con `PUSH_IMPL=webpush`; con `falso`, o las tres o
 * ninguna (media configuración es un error de captura, no una elección).
 */
function leerVapid(entorno: NodeJS.ProcessEnv, obligatorias: boolean): LlavesVapid | null {
  const puestas = VARIABLES_VAPID.filter((v) => entorno[v]);
  if (!obligatorias && puestas.length === 0) return null;
  const porQue = obligatorias ? 'PUSH_IMPL=webpush' : 'las otras llaves VAPID puestas';
  const publica = obligatoria('VAPID_PUBLIC_KEY', porQue, entorno);
  const privada = obligatoria('VAPID_PRIVATE_KEY', porQue, entorno);
  const sujeto = obligatoria('VAPID_SUBJECT', porQue, entorno);
  if (bytesBase64Url(publica) !== 65) {
    throw new Error('VAPID_PUBLIC_KEY no es una llave pública P-256 en base64url (65 bytes).');
  }
  if (bytesBase64Url(privada) !== 32) {
    throw new Error('VAPID_PRIVATE_KEY no es una llave privada P-256 en base64url (32 bytes).');
  }
  if (!/^(mailto:|https:\/\/)/.test(sujeto)) {
    throw new Error('VAPID_SUBJECT tiene que empezar con mailto: o https://.');
  }
  return { publica, privada, sujeto };
}

function leerModoDemo(entorno: NodeJS.ProcessEnv): boolean {
  const valor = entorno.MODO_DEMO;
  if (valor === undefined || valor === '' || valor === '0') return false;
  if (valor === '1') return true;
  throw new Error(`MODO_DEMO="${valor}" no es válido. Usa 1 (encendido) o 0 (apagado).`);
}

/**
 * Excepción EXPLÍCITA a "producción sin falsos" (deploy en Railway, docs/deploy-railway.md).
 * El primer deploy sale antes de contratar Facturama, Brevo, el volumen y las VAPID: sin
 * esto la API no arranca. No es un interruptor general: hay que NOMBRAR cada variable
 * (`PAC_IMPL,CORREO_IMPL,...`); un nombre que no es de un puerto truena, y cada falso
 * permitido se avisa en el log del arranque (`falsosEnProduccion`). Al conectar el servicio
 * real, se cambia su `*_IMPL` y se quita su nombre de aquí.
 *
 * El PAC falso en producción NO simula: el puerto es `TimbradoNoConectado` y las rutas que
 * timbran responden 503 "La facturación no está conectada todavía" (`PacConectadoGuard`).
 */
export const VARIABLE_FALSOS_PERMITIDOS = 'PERMITIR_FALSOS_EN_PRODUCCION';

function leerFalsosPermitidos(entorno: NodeJS.ProcessEnv): Set<string> {
  const crudo = entorno[VARIABLE_FALSOS_PERMITIDOS]?.trim();
  if (!crudo) return new Set();
  const nombres = crudo
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  const validos = Object.keys(IMPLEMENTACIONES);
  const desconocidos = nombres.filter((n) => !validos.includes(n));
  if (desconocidos.length > 0) {
    throw new Error(
      `${VARIABLE_FALSOS_PERMITIDOS} sólo acepta ${validos.join(', ')} (llegó ` +
        `${desconocidos.map((n) => `"${n}"`).join(', ')}).`,
    );
  }
  return new Set(nombres);
}

/**
 * Los puertos que arrancan en `falso` en producción por la excepción de arriba, para el
 * aviso del log. Vacío fuera de producción.
 */
export function falsosEnProduccion(entorno: NodeJS.ProcessEnv = process.env): string[] {
  if (entorno.NODE_ENV !== 'production') return [];
  const permitidos = leerFalsosPermitidos(entorno);
  return (Object.keys(IMPLEMENTACIONES) as VariableImpl[]).filter(
    (v) => impl(v, entorno) === 'falso' && permitidos.has(v),
  );
}

export function leerAdaptadoresConfig(entorno: NodeJS.ProcessEnv = process.env): AdaptadoresConfig {
  const pac = impl('PAC_IMPL', entorno);
  const correo = impl('CORREO_IMPL', entorno);
  const archivos = impl('ARCHIVOS_IMPL', entorno);
  const push = impl('PUSH_IMPL', entorno);

  if (entorno.NODE_ENV === 'production') {
    const enFalso = (
      Object.entries({
        PAC_IMPL: pac,
        CORREO_IMPL: correo,
        ARCHIVOS_IMPL: archivos,
        PUSH_IMPL: push,
      }) as [string, string][]
    )
      .filter(([, valor]) => valor === 'falso')
      .map(([variable]) => variable);
    const permitidos = leerFalsosPermitidos(entorno);
    const prohibidos = enFalso.filter((v) => !permitidos.has(v));
    if (prohibidos.length > 0) {
      throw new Error(
        `${prohibidos.map((v) => `${v}=falso`).join(', ')} no se permite con NODE_ENV=production. ` +
          'Elige la implementación real en esa variable (sin ella, el valor por defecto es falso), ' +
          `o nómbrala en ${VARIABLE_FALSOS_PERMITIDOS} si de verdad tiene que arrancar sin ella.`,
      );
    }
  }

  let configPac: ConfigPac = { impl: 'falso' };
  if (pac === 'facturama') {
    const porQue = 'PAC_IMPL=facturama';
    configPac = {
      impl: 'facturama',
      url: entorno.FACTURAMA_URL || FACTURAMA_URL_SANDBOX,
      usuario: obligatoria('FACTURAMA_USUARIO', porQue, entorno),
      password: obligatoria('FACTURAMA_PASSWORD', porQue, entorno),
    };
  }

  let configCorreo: ConfigCorreo = {
    impl: 'falso',
    directorio: entorno.CORREO_DIR_FALSO || undefined,
  };
  if (correo === 'brevo') {
    const porQue = 'CORREO_IMPL=brevo';
    configCorreo = {
      impl: 'brevo',
      apiKey: obligatoria('BREVO_API_KEY', porQue, entorno),
      remitente: {
        email: obligatoria('CORREO_REMITENTE', porQue, entorno),
        nombre: entorno.CORREO_REMITENTE_NOMBRE || 'Monitor SoftRestaurant',
      },
    };
  }

  let configArchivos: ConfigArchivos = {
    impl: 'falso',
    raiz: entorno.ARCHIVOS_RAIZ_FALSO || undefined,
  };
  if (archivos === 'disco') {
    const porQue = 'ARCHIVOS_IMPL=disco';
    const raiz = obligatoria('ARCHIVOS_RAIZ', porQue, entorno);
    if (!isAbsolute(raiz)) {
      throw new Error('ARCHIVOS_RAIZ tiene que ser una ruta absoluta (el volumen persistente).');
    }
    const secreto = obligatoria('ARCHIVOS_SECRETO', porQue, entorno);
    if (secreto.length < LONGITUD_MINIMA_SECRETO) {
      throw new Error(
        `ARCHIVOS_SECRETO debe tener al menos ${LONGITUD_MINIMA_SECRETO} caracteres.`,
      );
    }
    configArchivos = {
      impl: 'disco',
      raiz,
      secreto,
      urlBase: obligatoria('ARCHIVOS_URL_BASE', porQue, entorno),
    };
  }

  const hostsExtra = leerHostsExtra(entorno.PUSH_HOSTS_PERMITIDOS);
  let configPush: ConfigPush = {
    impl: 'falso',
    vapid: leerVapid(entorno, false),
    directorio: entorno.PUSH_DIR_FALSO || undefined,
    hostsExtra,
  };
  if (push === 'webpush') {
    configPush = { impl: 'webpush', vapid: leerVapid(entorno, true)!, hostsExtra };
  }

  return {
    pac: configPac,
    correo: configCorreo,
    archivos: configArchivos,
    push: configPush,
    modoDemo: leerModoDemo(entorno),
  };
}
