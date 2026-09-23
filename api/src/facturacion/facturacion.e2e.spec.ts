import { Logger, NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { csdSintetico, llavesRsa, type CsdSintetico } from '../../test/fixtures-csd';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import { ErrorTimbrado, type PuertoTimbrado } from '../adaptadores/timbrado/puerto';
import {
  MENSAJE_CSD_RECHAZADO,
  RFC_EMISOR_CSD_RECHAZADO,
} from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';
import type { PrismaService } from '../prisma/prisma.service';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

// E2E de F2-100 (datos fiscales y CSD) sobre la app REAL contra Postgres REAL, con el PAC FALSO
// (`PAC_IMPL=falso`, el default en test) y CSD SINTÉTICOS armados en memoria. Cubre el AC
// nocturno: alta de perfil y carga de CSD; "el .key y su contraseña nunca tocan la base ni un
// log" (recorre TODAS las tablas y captura TODO el log); un archivo inválido da error claro sin
// guardar nada (fila completa antes = después); 404 (nunca 403 ni 409) fuera de alcance. Y el
// "Y además (de F2-232)": el receptor frecuente en la ficha de Clientes.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const KEYS = {
  a1: 'msr_sintetica-facturacion-F2-100-sucursal-a1-000000000001',
  b1: 'msr_sintetica-facturacion-F2-100-sucursal-b1-000000000002',
} as const;

const b64 = (b: Buffer) => b.toString('base64');

describe('Datos fiscales y CSD (e2e, F2-100)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  // --- Captura de TODO lo que se loguea mientras corre la suite. ---
  const log: string[] = [];
  const texto = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (Buffer.isBuffer(a)) return a.toString('utf8');
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  const respuestas: string[] = [];

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const guardar = async (r: request.Test) => {
    const res = await r;
    respuestas.push(res.text ?? '');
    return res;
  };
  const get = async (u: Usuario, ruta: string, query: Record<string, string> = {}) =>
    guardar(
      request(url)
        .get(ruta)
        .query(query)
        .set('Authorization', `Bearer ${await token(u)}`),
    );
  const put = async (u: Usuario, body: object) =>
    guardar(
      request(url)
        .put('/facturacion/perfil-fiscal')
        .set('Authorization', `Bearer ${await token(u)}`)
        .send(body),
    );
  const csd = async (u: Usuario, empresaId: string, c: Partial<CsdSintetico> & object) =>
    guardar(
      request(url)
        .post('/facturacion/perfil-fiscal/csd')
        .set('Authorization', `Bearer ${await token(u)}`)
        .send({
          empresaId,
          certificado: b64(c.certificado ?? BUENO.certificado),
          llavePrivada: b64(c.llavePrivada ?? BUENO.llavePrivada),
          contrasena: c.contrasena ?? BUENO.contrasena,
        }),
    );
  const fila = (empresaId: string) => prisma.perfilFiscal.findFirst({ where: { empresaId } });

  const PERFIL_A = {
    empresaId: FX.empresaA,
    rfc: ' eku9003173c9 ',
    razonSocial: '  ESCUELA KEMPER URGATE ',
    regimenFiscal: '601',
    cp: '06700',
    serie: 'a',
  };

  // CSD sintéticos: el bueno (EKU, 2025–2029), y los que tienen que fallar.
  const LLAVES = llavesRsa();
  // Número de certificado PROPIO de este e2e: el del seed (30001000000500003416) puede estar en la
  // base (dev sembrada, o `seed-facturacion.spec`), y el control del buscador lo contaría.
  const NO_CERT = '30001000000500002100';
  const BUENO = csdSintetico({ llaves: LLAVES, noCertificado: NO_CERT });
  const OTRO = csdSintetico();
  const VENCIDO = csdSintetico({
    llaves: LLAVES,
    desde: new Date('2021-01-01T06:00:00Z'),
    hasta: new Date('2025-01-01T06:00:00Z'),
  });
  const DE_OTRO_RFC = csdSintetico({ llaves: LLAVES, rfc: 'XIA190128J61' });
  const RECHAZABLE = csdSintetico({ llaves: LLAVES, rfc: RFC_EMISOR_CSD_RECHAZADO });

  // Tramos del .key que se buscan en base y log: dos posiciones del base64 y una del hex.
  const secretos = (c: CsdSintetico) => {
    const k64 = b64(c.llavePrivada);
    const khex = c.llavePrivada.toString('hex');
    return [
      c.contrasena,
      k64.slice(60, 120),
      k64.slice(k64.length - 120, k64.length - 60),
      khex.slice(200, 280),
    ];
  };

  beforeAll(async () => {
    await prisma.$connect();
    await limpiarFixtures(prisma);
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    for (const nivel of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
        log.push(texto(args));
      });
    }
    for (const nivel of ['log', 'error', 'warn', 'info', 'debug'] as const) {
      jest.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
        log.push(texto(args));
      });
    }
    // Y la salida cruda: un logger futuro que escriba directo a stdout/stderr también cuenta.
    for (const flujo of [process.stdout, process.stderr]) {
      const original = flujo.write.bind(flujo);
      jest.spyOn(flujo, 'write').mockImplementation(((trozo: unknown, ...resto: unknown[]) => {
        log.push(texto([trozo]));
        return (original as (...a: unknown[]) => boolean)(trozo, ...resto);
      }) as typeof flujo.write);
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    app.useLogger({
      log: (...a: unknown[]) => void log.push(texto(a)),
      error: (...a: unknown[]) => void log.push(texto(a)),
      warn: (...a: unknown[]) => void log.push(texto(a)),
      debug: (...a: unknown[]) => void log.push(texto(a)),
      verbose: (...a: unknown[]) => void log.push(texto(a)),
      fatal: (...a: unknown[]) => void log.push(texto(a)),
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  describe('alcance y roles', () => {
    it('sin datos fiscales: perfil null y el PAC es el simulado', async () => {
      const r = await get(USUARIOS.adminEmpresaA, '/facturacion/perfil-fiscal', {
        empresaId: FX.empresaA,
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ perfil: null, pacSimulado: true });
    });

    it('CSD sin datos fiscales: 409 para la empresa propia', async () => {
      const r = await csd(USUARIOS.adminEmpresaA, FX.empresaA, {});
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Guarda primero los datos fiscales/);
    });

    it('empresa ajena o inexistente: el MISMO 404 en las tres rutas (nunca 409 ni 403)', async () => {
      const casos: Array<[Usuario, string]> = [
        [USUARIOS.adminEmpresaA, FX.empresaB],
        [USUARIOS.adminEmpresaA, FX.inexistente],
        [USUARIOS.adminGlobal, FX.inexistente],
      ];
      for (const [u, empresaId] of casos) {
        const g = await get(u, '/facturacion/perfil-fiscal', { empresaId });
        const p = await put(u, { ...PERFIL_A, empresaId });
        // B no tiene perfil: si esto diera 409 confirmaría que B existe.
        const c = await csd(u, empresaId, {});
        for (const res of [g, p, c]) {
          expect(res.status).toBe(404);
          // El mismo cuerpo que cualquier 404 del helper de scope: no distingue los casos.
          expect(res.body).toEqual({
            statusCode: 404,
            message: 'Recurso no encontrado',
            error: 'Not Found',
          });
        }
      }
      expect(await prisma.perfilFiscal.count({ where: { empresaId: FX.empresaB } })).toBe(0);
    });

    it('visor: 403 por rol en las tres rutas', async () => {
      const g = await get(USUARIOS.visorA, '/facturacion/perfil-fiscal', {
        empresaId: FX.empresaA,
      });
      const p = await put(USUARIOS.visorA, PERFIL_A);
      const c = await csd(USUARIOS.visorA, FX.empresaA, {});
      for (const res of [g, p, c]) expect(res.status).toBe(403);
      expect(await fila(FX.empresaA)).toBeNull();
    });

    it('sin token: 401', async () => {
      const r = await request(url)
        .get('/facturacion/perfil-fiscal')
        .query({ empresaId: FX.empresaA });
      expect(r.status).toBe(401);
    });
  });

  describe('datos fiscales', () => {
    it('validaciones campo por campo (400) y nada se guarda', async () => {
      const malos: Array<[Record<string, string>, RegExp]> = [
        [{ rfc: 'EKU9003173' }, /rfc no tiene el formato del SAT/],
        [{ rfc: 'XAXX010101000', regimenFiscal: '616' }, /RFC genérico/],
        [{ regimenFiscal: '612' }, /régimen 612 no existe o no aplica a persona moral/],
        [{ regimenFiscal: '999' }, /régimen 999/],
        [{ rfc: 'XOJI740919U48', regimenFiscal: '601' }, /no aplica a persona física/],
        [{ cp: '1234' }, /cp debe tener 5 dígitos/],
        [{ serie: 'A-1' }, /serie debe tener de 1 a 25/],
        [{ razonSocial: '   ' }, /razonSocial debe tener entre 1 y 254/],
      ];
      for (const [cambio, mensaje] of malos) {
        const r = await put(USUARIOS.adminEmpresaA, { ...PERFIL_A, ...cambio });
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body.message)).toMatch(mensaje);
      }
      expect(await fila(FX.empresaA)).toBeNull();
    });

    it('alta: guarda normalizado (RFC y serie en mayúsculas, sin espacios)', async () => {
      const r = await put(USUARIOS.adminEmpresaA, PERFIL_A);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        csdQuitado: false,
        pacSimulado: true,
        perfil: {
          rfc: 'EKU9003173C9',
          razonSocial: 'ESCUELA KEMPER URGATE',
          regimenFiscal: '601',
          cp: '06700',
          serie: 'A',
          folioActual: 0,
          activo: true,
          emisorRegistrado: false,
          csd: null,
        },
      });
      expect(await fila(FX.empresaA)).toMatchObject({
        rfc: 'EKU9003173C9',
        creadoPor: USUARIOS.adminEmpresaA.id,
        csdNoCertificado: null,
      });
    });

    it('edición: una sola fila por empresa; régimen 626 aplica a moral', async () => {
      const r = await put(USUARIOS.adminGlobal, { ...PERFIL_A, regimenFiscal: '626', serie: 'B2' });
      expect(r.status).toBe(200);
      expect(r.body.perfil).toMatchObject({ regimenFiscal: '626', serie: 'B2' });
      expect(await prisma.perfilFiscal.count({ where: { empresaId: FX.empresaA } })).toBe(1);
      await put(USUARIOS.adminEmpresaA, PERFIL_A);
    });

    it('catálogo de regímenes', async () => {
      const r = await get(USUARIOS.visorA, '/facturacion/regimenes-fiscales');
      expect(r.status).toBe(200);
      expect(r.body).toContainEqual({
        clave: '601',
        descripcion: 'General de Ley Personas Morales',
        fisica: false,
        moral: true,
      });
    });
  });

  describe('carga del CSD', () => {
    it('cada archivo inválido: 400 con su mensaje y la fila queda IDÉNTICA', async () => {
      const antes = await fila(FX.empresaA);
      const casos: Array<[Partial<CsdSintetico>, RegExp]> = [
        [
          { contrasena: 'Otra-Contrasena-Incorrecta-F2-100-xyz' },
          /contraseña de la llave privada no es correcta/,
        ],
        [{ contrasena: '' }, /contraseña de la llave privada no es correcta/],
        [
          { certificado: Buffer.from('esto no es un certificado') },
          /\.cer no es un certificado válido/,
        ],
        [
          { llavePrivada: Buffer.from('esto no es una llave') },
          /\.key no es una llave privada del SAT/,
        ],
        [
          { llavePrivada: OTRO.llavePrivada, contrasena: OTRO.contrasena },
          /no corresponde al certificado/,
        ],
        [
          { certificado: DE_OTRO_RFC.certificado },
          /es del RFC XIA190128J61 y los datos fiscales son del RFC EKU9003173C9/,
        ],
        [{ certificado: VENCIDO.certificado }, /venció el 1 de enero de 2025/],
        [{ llavePrivada: Buffer.alloc(16 * 1024 + 1, 1) }, /pesa más de 16 KB/],
      ];
      for (const [cambio, mensaje] of casos) {
        const r = await csd(USUARIOS.adminEmpresaA, FX.empresaA, cambio);
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body.message)).toMatch(mensaje);
        expect(await fila(FX.empresaA)).toEqual(antes);
      }
      // Base64 inválido y archivo vacío los para el DTO / el servicio.
      const token = await app.get(TokensService).firmarAccess({
        id: USUARIOS.adminEmpresaA.id,
        rol: USUARIOS.adminEmpresaA.rol,
        empresaId: USUARIOS.adminEmpresaA.empresaId,
      });
      for (const [body, mensaje] of [
        [{ certificado: '%%%no-base64%%%' }, /certificado debe ir en base64/],
        [{ llavePrivada: '' }, /llavePrivada está vacío/],
      ] as const) {
        const r = await guardar(
          request(url)
            .post('/facturacion/perfil-fiscal/csd')
            .set('Authorization', `Bearer ${token}`)
            .send({
              empresaId: FX.empresaA,
              contrasena: BUENO.contrasena,
              ...{ certificado: b64(BUENO.certificado), llavePrivada: b64(BUENO.llavePrivada) },
              ...body,
            }),
        );
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body.message)).toMatch(mensaje);
      }
      expect(await fila(FX.empresaA)).toEqual(antes);
    });

    it('el PAC rechaza el CSD: 400 con su mensaje y nada se guarda', async () => {
      const r1 = await put(USUARIOS.adminGlobal, {
        ...PERFIL_A,
        empresaId: FX.empresaB,
        rfc: RFC_EMISOR_CSD_RECHAZADO,
        // Es de persona FÍSICA (4 letras): régimen de física.
        regimenFiscal: '612',
      });
      expect(r1.status).toBe(200);
      const antes = await fila(FX.empresaB);
      const r = await csd(USUARIOS.adminGlobal, FX.empresaB, {
        certificado: RECHAZABLE.certificado,
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toEqual([MENSAJE_CSD_RECHAZADO]);
      expect(await fila(FX.empresaB)).toEqual(antes);
    });

    it('el PAC no responde: 503 y nada se guarda', async () => {
      const pac = app.get<PuertoTimbrado>(PUERTO_TIMBRADO);
      const espia = jest
        .spyOn(pac, 'registrarCsd')
        .mockRejectedValueOnce(
          new ErrorTimbrado(
            'PAC_SIN_RESPUESTA',
            'No hubo respuesta del servicio de timbrado.',
            true,
          ),
        );
      const antes = await fila(FX.empresaA);
      const r = await csd(USUARIOS.adminEmpresaA, FX.empresaA, {});
      expect(r.status).toBe(503);
      expect(r.body.message).toBe('No hubo respuesta del servicio de timbrado.');
      expect(await fila(FX.empresaA)).toEqual(antes);
      espia.mockRestore();
    });

    it('CSD bueno: alta en el PAC y SÓLO metadata en la base', async () => {
      const pac = app.get<PuertoTimbrado>(PUERTO_TIMBRADO);
      const espia = jest.spyOn(pac, 'registrarCsd');
      const r = await csd(USUARIOS.adminEmpresaA, FX.empresaA, {});
      expect(r.status).toBe(200);
      expect(r.body.perfil).toMatchObject({
        rfc: 'EKU9003173C9',
        emisorRegistrado: true,
        csd: {
          noCertificado: NO_CERT,
          rfc: 'EKU9003173C9',
          vigenteDesde: '2025-01-01T06:00:00.000Z',
          vigenteHasta: '2029-01-01T06:00:00.000Z',
        },
      });
      expect(espia).toHaveBeenCalledTimes(1);
      expect(espia.mock.calls[0][0]).toMatchObject({ rfc: 'EKU9003173C9', reemplazar: false });
      expect(await fila(FX.empresaA)).toMatchObject({
        facturamaOrgId: 'EKU9003173C9',
        csdNoCertificado: NO_CERT,
        csdRfc: 'EKU9003173C9',
        csdVigenteDesde: new Date('2025-01-01T06:00:00.000Z'),
        csdVigenteHasta: new Date('2029-01-01T06:00:00.000Z'),
        csdCargadoPor: USUARIOS.adminEmpresaA.id,
      });
      // La auditoría: nombres de campos, nunca valores.
      const auditoria = log.filter((l) => l.includes('perfil_fiscal.cargar_csd'));
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toContain(
        '"campos":["csd_no_certificado","csd_vigencia","facturama_org_id"]',
      );
      espia.mockRestore();
    });

    it('volver a cargarlo es un REEMPLAZO en el PAC', async () => {
      const pac = app.get<PuertoTimbrado>(PUERTO_TIMBRADO);
      const espia = jest.spyOn(pac, 'registrarCsd');
      const r = await csd(USUARIOS.adminEmpresaA, FX.empresaA, {});
      expect(r.status).toBe(200);
      expect(espia.mock.calls[0][0]).toMatchObject({ reemplazar: true });
      espia.mockRestore();
    });

    it('AC: el .key y su contraseña NUNCA tocan la base (todas las tablas) ni el log ni una respuesta', async () => {
      const tablas = await prisma.$queryRaw<Array<{ tabla: string }>>`
        SELECT table_name AS tabla FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      expect(tablas.map((t) => t.tabla)).toEqual(
        expect.arrayContaining(['perfiles_fiscales', 'receptores_frecuentes', 'empresas']),
      );
      const buscados = [
        ...secretos(BUENO),
        ...secretos(OTRO),
        'Otra-Contrasena-Incorrecta-F2-100-xyz',
      ];
      // Sanidad del buscador: sí encuentra lo que SÍ está (el número de certificado de A), en la
      // fila de A y sólo ahí (acotado a la empresa: otras filas de la base no cuentan).
      const control = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "perfiles_fiscales" AS x
         WHERE x.empresa_id = $2::uuid AND strpos(to_jsonb(x)::text, $1) > 0`,
        NO_CERT,
        FX.empresaA,
      );
      expect(control[0].n).toBe(1);
      for (const { tabla } of tablas) {
        for (const secreto of buscados) {
          const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
            `SELECT count(*)::int AS n FROM "${tabla.replace(/"/g, '""')}" AS x WHERE strpos(to_jsonb(x)::text, $1) > 0`,
            secreto,
          );
          if (n !== 0) throw new Error(`Un secreto del CSD apareció en la tabla ${tabla}`);
        }
      }
      // El log sí registró cosas (la auditoría), y ninguna lleva un secreto.
      expect(log.length).toBeGreaterThan(0);
      const todo = log.join('\n');
      const todasLasRespuestas = respuestas.join('\n');
      for (const secreto of buscados) {
        expect(todo.includes(secreto)).toBe(false);
        expect(todasLasRespuestas.includes(secreto)).toBe(false);
      }
    });

    it('cambiar el RFC con CSD cargado QUITA el CSD (era de otro RFC)', async () => {
      const r = await put(USUARIOS.adminEmpresaA, {
        ...PERFIL_A,
        rfc: 'XIA190128J61',
      });
      expect(r.status).toBe(200);
      expect(r.body.csdQuitado).toBe(true);
      expect(r.body.perfil).toMatchObject({
        rfc: 'XIA190128J61',
        emisorRegistrado: false,
        csd: null,
      });
      expect(await fila(FX.empresaA)).toMatchObject({
        facturamaOrgId: null,
        csdNoCertificado: null,
        csdVigenteHasta: null,
        csdCargadoPor: null,
      });
      // Y el CSD del RFC nuevo entra como ALTA, no como reemplazo.
      const pac = app.get<PuertoTimbrado>(PUERTO_TIMBRADO);
      const espia = jest.spyOn(pac, 'registrarCsd');
      const c = await csd(USUARIOS.adminEmpresaA, FX.empresaA, {
        certificado: DE_OTRO_RFC.certificado,
      });
      expect(c.status).toBe(200);
      expect(espia.mock.calls[0][0]).toMatchObject({ rfc: 'XIA190128J61', reemplazar: false });
      espia.mockRestore();
    });
  });

  describe('receptor frecuente en la ficha de Clientes (Y además de F2-232)', () => {
    const idDe = async (sucursalId: string, origenSrId: string) =>
      (
        await prisma.clienteCatalogo.findFirstOrThrow({
          where: { sucursalId, origenSrId },
          select: { id: true },
        })
      ).id;
    const ficha = async (u: Usuario, empresaId: string, id: string) => {
      const r = await get(u, `/catalogos/clientes/${id}/ficha`, {
        empresaId,
        desde: '2026-09-01',
        hasta: '2026-09-02',
      });
      expect(r.status).toBe(200);
      return r.body as { receptor: unknown };
    };

    beforeAll(async () => {
      const sinc = async (key: string, sincronizacionId: string, registros: object[]) => {
        const base = {
          catalogo: 'clientes',
          sincronizacionId,
          capturadoAt: '2026-09-01T10:00:00.000Z',
        };
        const p = await request(url)
          .post('/ingesta/catalogos')
          .set('X-Api-Key', key)
          .send({ ...base, registros });
        expect(p.status).toBe(200);
        expect(p.body.rechazados).toEqual([]);
        const c = await request(url)
          .post('/ingesta/catalogos/cierre')
          .set('X-Api-Key', key)
          .send({ ...base, total: registros.length, rechazados: 0 });
        expect(c.status).toBe(200);
      };
      await sinc(KEYS.a1, 'f2100000-0000-4000-8000-00000000c0a1', [
        // RFC "tal cual" del POS: minúsculas y espacios.
        { origenSrId: 'C1', nombre: 'Kemper', rfc: 'eku9003173c9 ' },
        { origenSrId: 'C2', nombre: 'Sin RFC', rfc: null },
        // Su RFC SÓLO tiene receptor en la empresa B.
        { origenSrId: 'C3', nombre: 'Xenon', rfc: 'XIA190128J61' },
        { origenSrId: 'C4', nombre: 'Público en general', rfc: 'XAXX010101000' },
      ]);
      await sinc(KEYS.b1, 'f2100000-0000-4000-8000-00000000c0b1', [
        { origenSrId: 'C9', nombre: 'Xenon B', rfc: 'xia190128j61' },
      ]);
      const escribir = (empresaId: string) =>
        new ScopedPrismaService(prisma as unknown as PrismaService).facturacion({
          tipo: 'empresa',
          empresaId,
        });
      const ahora = new Date('2026-09-02T12:00:00Z');
      await escribir(FX.empresaA).guardarReceptor(
        FX.empresaA,
        {
          rfc: 'EKU9003173C9',
          razonSocial: 'ESCUELA KEMPER URGATE',
          regimenFiscal: '601',
          cp: '42501',
          usoCfdi: 'G03',
          email: 'facturas@ejemplo.test',
        },
        ahora,
      );
      await escribir(FX.empresaB).guardarReceptor(
        FX.empresaB,
        {
          rfc: ' xia190128j61',
          razonSocial: 'XENON INDUSTRIAL ARTICLES',
          regimenFiscal: '601',
          cp: '76343',
          usoCfdi: 'G03',
          email: null,
        },
        ahora,
      );
      // Un RFC genérico no se guarda como receptor.
      await expect(
        escribir(FX.empresaA).guardarReceptor(
          FX.empresaA,
          {
            rfc: 'XAXX010101000',
            razonSocial: 'PUBLICO',
            regimenFiscal: '616',
            cp: '06700',
            usoCfdi: 'S01',
            email: null,
          },
          ahora,
        ),
      ).rejects.toThrow();
      // Y el helper no escribe receptores en otra empresa con el scope de A: 404.
      await expect(
        escribir(FX.empresaA).guardarReceptor(
          FX.empresaB,
          {
            rfc: 'EKU9003173C9',
            razonSocial: 'X',
            regimenFiscal: '601',
            cp: '06700',
            usoCfdi: 'G03',
            email: null,
          },
          ahora,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mismo RFC normalizado en la MISMA empresa: liga', async () => {
      const f = await ficha(USUARIOS.visorA, FX.empresaA, await idDe(FX.sucursalA1, 'C1'));
      expect(f.receptor).toEqual({
        rfc: 'EKU9003173C9',
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '42501',
        usoCfdi: 'G03',
        email: 'facturas@ejemplo.test',
      });
    });

    it('RFC con receptor sólo en OTRA empresa: no liga (y en su empresa sí)', async () => {
      expect(
        (await ficha(USUARIOS.visorA, FX.empresaA, await idDe(FX.sucursalA1, 'C3'))).receptor,
      ).toBeNull();
      expect(
        (await ficha(USUARIOS.visorB, FX.empresaB, await idDe(FX.sucursalB1, 'C9'))).receptor,
      ).toMatchObject({
        rfc: 'XIA190128J61',
      });
    });

    it('cliente sin RFC, o con RFC genérico: no liga con nada', async () => {
      expect(
        (await ficha(USUARIOS.visorA, FX.empresaA, await idDe(FX.sucursalA1, 'C2'))).receptor,
      ).toBeNull();
      expect(
        (await ficha(USUARIOS.visorA, FX.empresaA, await idDe(FX.sucursalA1, 'C4'))).receptor,
      ).toBeNull();
    });

    it('la ficha de un cliente de otra empresa sigue siendo 404', async () => {
      const r = await get(
        USUARIOS.visorA,
        `/catalogos/clientes/${await idDe(FX.sucursalB1, 'C9')}/ficha`,
        {
          empresaId: FX.empresaA,
          desde: '2026-09-01',
          hasta: '2026-09-02',
        },
      );
      expect(r.status).toBe(404);
    });
  });
});
