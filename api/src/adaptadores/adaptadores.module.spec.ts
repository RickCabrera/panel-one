import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RelojModule } from '../comun/reloj';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdaptadoresModule,
  PUERTO_ARCHIVOS,
  PUERTO_CORREO,
  PUERTO_PUSH,
  PUERTO_TIMBRADO,
} from './adaptadores.module';
import { ArchivosDisco } from './archivos/archivos-disco';
import type { PuertoArchivos } from './archivos/puerto';
import { CorreoBrevo } from './correo/correo-brevo';
import { CorreoFalso } from './correo/correo-falso';
import type { PuertoCorreo } from './correo/puerto';
import { PushFalso } from './push/push-falso';
import { PushWebPush } from './push/push-webpush';
import type { PuertoPush } from './push/puerto';
import type { PuertoTimbrado } from './timbrado/puerto';
import { TimbradoFacturama } from './timbrado/timbrado-facturama';
import { TimbradoFalso } from './timbrado/timbrado-falso';

/**
 * Un "servicio de negocio" de prueba: inyecta los TOKENS y tipa con las interfaces,
 * como lo harán F2-100…F2-141. Este test es el "Listo cuando" de F2-202: el mismo
 * servicio, sin tocarlo, recibe el falso o el real según la variable.
 */
@Injectable()
class ServicioDeNegocio {
  constructor(
    @Inject(PUERTO_TIMBRADO) readonly timbrado: PuertoTimbrado,
    @Inject(PUERTO_CORREO) readonly correo: PuertoCorreo,
    @Inject(PUERTO_ARCHIVOS) readonly archivos: PuertoArchivos,
    @Inject(PUERTO_PUSH) readonly push: PuertoPush,
  ) {}
}

const VARIABLES = [
  'NODE_ENV',
  'PAC_IMPL',
  'FACTURAMA_USUARIO',
  'FACTURAMA_PASSWORD',
  'CORREO_IMPL',
  'BREVO_API_KEY',
  'CORREO_REMITENTE',
  'ARCHIVOS_IMPL',
  'ARCHIVOS_RAIZ',
  'ARCHIVOS_SECRETO',
  'ARCHIVOS_URL_BASE',
  'PUSH_IMPL',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'PUSH_DIR_FALSO',
  'PUSH_HOSTS_PERMITIDOS',
  'MODO_DEMO',
] as const;

const REALES: Record<string, string> = {
  PAC_IMPL: 'facturama',
  FACTURAMA_USUARIO: 'usuario-sintetico',
  FACTURAMA_PASSWORD: 'password-sintetico',
  CORREO_IMPL: 'brevo',
  BREVO_API_KEY: 'api-key-sintetica',
  CORREO_REMITENTE: 'facturas@ejemplo.test',
  ARCHIVOS_IMPL: 'disco',
  ARCHIVOS_RAIZ: process.platform === 'win32' ? 'C:\\datos\\archivos' : '/datos/archivos',
  ARCHIVOS_SECRETO: 'secreto-sintetico-de-archivos-de-32-o-mas-000',
  ARCHIVOS_URL_BASE: 'https://panel.ejemplo.test/api/archivos',
  // Llaves VAPID SINTÉTICAS: sólo tienen el largo correcto.
  PUSH_IMPL: 'webpush',
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
  VAPID_PRIVATE_KEY: Buffer.alloc(32, 9).toString('base64url'),
  VAPID_SUBJECT: 'mailto:soporte@ejemplo.test',
};

describe('AdaptadoresModule (F2-202)', () => {
  const originales: Partial<Record<string, string>> = {};

  beforeAll(() => {
    for (const v of VARIABLES) originales[v] = process.env[v];
  });

  afterEach(() => {
    for (const v of VARIABLES) {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    }
  });

  function entorno(valores: Record<string, string>): void {
    for (const v of VARIABLES) delete process.env[v];
    Object.assign(process.env, { NODE_ENV: 'test', ...valores });
  }

  async function servicio(): Promise<ServicioDeNegocio> {
    const modulo = await Test.createTestingModule({
      imports: [PrismaModule, RelojModule, AdaptadoresModule],
      providers: [ServicioDeNegocio],
    }).compile();
    return modulo.get(ServicioDeNegocio);
  }

  it('sin variables, el servicio recibe los cuatro falsos', async () => {
    entorno({});
    const s = await servicio();
    expect(s.timbrado).toBeInstanceOf(TimbradoFalso);
    expect(s.correo).toBeInstanceOf(CorreoFalso);
    expect(s.archivos).toBeInstanceOf(ArchivosDisco);
    expect(s.push).toBeInstanceOf(PushFalso);
    // Sin llaves VAPID, el falso no ofrece clave: la web dice "no configuradas".
    expect(s.push.clavePublica).toBeNull();
  });

  it('PAC_IMPL=facturama cambia SÓLO el timbrado, sin tocar el servicio', async () => {
    entorno({
      PAC_IMPL: 'facturama',
      FACTURAMA_USUARIO: REALES.FACTURAMA_USUARIO,
      FACTURAMA_PASSWORD: REALES.FACTURAMA_PASSWORD,
    });
    const s = await servicio();
    expect(s.timbrado).toBeInstanceOf(TimbradoFacturama);
    expect(s.correo).toBeInstanceOf(CorreoFalso);
  });

  it('con las cuatro reales, el mismo servicio recibe las cuatro reales', async () => {
    entorno(REALES);
    const s = await servicio();
    expect(s.timbrado).toBeInstanceOf(TimbradoFacturama);
    expect(s.correo).toBeInstanceOf(CorreoBrevo);
    expect(s.archivos).toBeInstanceOf(ArchivosDisco);
    expect(s.push).toBeInstanceOf(PushWebPush);
    expect(s.push.clavePublica).toBe(REALES.VAPID_PUBLIC_KEY);
  });

  it('PUSH_IMPL=webpush cambia SÓLO el push', async () => {
    const { PUSH_IMPL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = REALES;
    entorno({ PUSH_IMPL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT });
    const s = await servicio();
    expect(s.push).toBeInstanceOf(PushWebPush);
    expect(s.timbrado).toBeInstanceOf(TimbradoFalso);
    expect(s.correo).toBeInstanceOf(CorreoFalso);
  });

  it('NODE_ENV=production con un puerto en falso: el módulo NO compila y nombra la variable', async () => {
    entorno({ ...REALES, NODE_ENV: 'production', CORREO_IMPL: 'falso' });
    await expect(servicio()).rejects.toThrow(
      'CORREO_IMPL=falso no se permite con NODE_ENV=production',
    );
  });

  it('NODE_ENV=production sin ninguna variable: no compila', async () => {
    entorno({ NODE_ENV: 'production' });
    await expect(servicio()).rejects.toThrow(/PAC_IMPL=falso.*NODE_ENV=production/);
  });
});
