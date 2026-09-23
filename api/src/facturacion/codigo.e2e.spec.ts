import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { INTENTOS_CODIGO } from '../scope/escritura-sucursal';
import { CODIGO_EJEMPLO, esCodigoValido, GeneradorCodigo, generarCodigo } from './codigo';
import { MENSAJE_CODIGO_FORMATO, MENSAJE_CODIGO_NO_ENCONTRADO } from './codigos.service';

// E2E del código corto de facturación (F2-101) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Cubre: el hook en la ingesta (idempotencia, savepoint,
// colisiones, concurrencia), los constraints de la base, la consulta PÚBLICA (estados, que ninguno
// fuera de `pendiente` filtre datos, rate limit por IP) y la vigencia por empresa.
//
// La app corre con TRUST_PROXY_SALTOS=1: cada consulta pública lleva su propia IP en
// X-Forwarded-For (así el límite de 10/min no se cruza entre pruebas), y la del rate limit usa
// dos IP fijas.

const KEYS = {
  a1: 'msr_sintetica-codigo-F2-101-sucursal-a1-000000000001',
  b1: 'msr_sintetica-codigo-F2-101-sucursal-b1-000000000002',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

/** El azar de la ingesta, controlable: una cola de códigos, o una falla. */
class GeneradorControlado extends GeneradorCodigo {
  cola: string[] = [];
  falla: Error | null = null;
  llamadas = 0;
  generar(): string {
    this.llamadas += 1;
    if (this.falla) throw this.falla;
    return this.cola.shift() ?? generarCodigo();
  }
  reiniciar(): void {
    this.cola = [];
    this.falla = null;
    this.llamadas = 0;
  }
}

/** El reloj del servidor, movible: `null` = el de verdad. */
class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

// 15 de septiembre de 2026, 14:00 en CDMX. La zona de las sucursales de fixtures es la default.
const CIERRE = '2026-09-15T14:00:00.000-06:00';
const FIN_DE_SEPTIEMBRE = '2026-10-01T06:00:00.000Z';

function cheque(id: string, folioSr: string, cambios: Record<string, unknown> = {}) {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: `T-${folioSr}`,
      abiertoAt: '2026-09-15T13:00:00.000-06:00',
      cerradoAt: CIERRE,
      mesa: '7',
      mesero: 'MESERO SINTETICO',
      comensales: 2,
      subtotal: '271.98',
      impuestos: '43.52',
      descuentos: '0',
      propina: '0',
      total: '315.50',
      cancelado: false,
      partidas: [
        { producto: 'Platillo sintético', cantidad: '2', precioUnit: '135.99', total: '271.98' },
      ],
      pagos: [{ formaRaw: 'EFECTIVO', monto: '315.50' }],
      ...cambios,
    },
  };
}

describe('Código corto de facturación (e2e, F2-101)', () => {
  const prisma = new PrismaClient();
  const generador = new GeneradorControlado();
  const reloj = new RelojControlado();
  let app: NestExpressApplication;
  let url: string;
  const errores: string[] = [];

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  async function lote(key: string, eventos: object[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    return res.body as {
      procesados: string[];
      rechazados: { id: string; reintentable: boolean }[];
    };
  }

  /** Consulta pública desde una IP propia (no gasta el límite de nadie más). */
  let ips = 0;
  const consultar = (codigo: string, ip = `10.1.${Math.floor(++ips / 250)}.${ips % 250}`) =>
    request(url)
      .get(`/facturacion/codigo/${encodeURIComponent(codigo)}`)
      .set('X-Forwarded-For', ip);

  const chequeDe = (folioSr: string, sucursalId: string = FX.sucursalA1) =>
    prisma.cheque.findUniqueOrThrow({
      where: { sucursalId_folioSr: { sucursalId, folioSr } },
      include: { partidas: { orderBy: { orden: 'asc' } }, pagos: { orderBy: { id: 'asc' } } },
    });
  const codigoDe = async (folioSr: string, sucursalId: string = FX.sucursalA1) =>
    prisma.codigoFacturacion.findFirst({ where: { cheque: { sucursalId, folioSr } } });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      errores.push(args.map(String).join(' '));
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeneradorCodigo)
      .useValue(generador)
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  beforeEach(() => {
    generador.reiniciar();
    reloj.t = null;
    errores.length = 0;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  describe('ingesta: un código por cheque facturable', () => {
    it('un cheque cerrado recibe UN código con el formato y vence al fin del mes LOCAL de su cierre', async () => {
      const r = await lote(KEYS.a1, [cheque('c1', 'COD-1')]);
      expect(r).toEqual({ procesados: ['c1'], rechazados: [] });
      const c = await chequeDe('COD-1');
      const cod = await codigoDe('COD-1');
      expect(cod).toMatchObject({
        chequeId: c.id,
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        estado: 'pendiente',
      });
      expect(esCodigoValido(cod!.codigo)).toBe(true);
      expect(cod!.expiraAt.toISOString()).toBe(FIN_DE_SEPTIEMBRE);
    });

    it('reenviar el mismo cheque 3 veces deja la fila del código idéntica (id, código, fechas)', async () => {
      await lote(KEYS.a1, [cheque('i1', 'COD-IDEM')]);
      const antes = await codigoDe('COD-IDEM');
      const chequeAntes = JSON.stringify(await chequeDe('COD-IDEM'));
      for (let i = 0; i < 3; i++) {
        expect(await lote(KEYS.a1, [cheque('i1', 'COD-IDEM')])).toEqual({
          procesados: ['i1'],
          rechazados: [],
        });
      }
      expect(await codigoDe('COD-IDEM')).toEqual(antes);
      expect(JSON.stringify(await chequeDe('COD-IDEM'))).toBe(chequeAntes);
      expect(generador.llamadas).toBe(1);
    });

    it('un reenvío CON cambios conserva el código y su vencimiento (no se recalcula)', async () => {
      await lote(KEYS.a1, [cheque('m1', 'COD-CAMBIA')]);
      const antes = await codigoDe('COD-CAMBIA');
      await lote(KEYS.a1, [
        cheque('m2', 'COD-CAMBIA', { cerradoAt: '2026-10-02T12:00:00-06:00', total: '400.00' }),
      ]);
      expect(await codigoDe('COD-CAMBIA')).toEqual(antes);
    });

    it('abierto: sin código; al cerrarse, lo recibe', async () => {
      await lote(KEYS.a1, [cheque('a1', 'COD-ABIERTO', { cerradoAt: null })]);
      expect(await codigoDe('COD-ABIERTO')).toBeNull();
      await lote(KEYS.a1, [cheque('a2', 'COD-ABIERTO')]);
      expect(await codigoDe('COD-ABIERTO')).not.toBeNull();
    });

    it('cancelado, en $0 o negativo: sin código (DECISION PROVISIONAL, esquema-sr §2)', async () => {
      await lote(KEYS.a1, [
        cheque('x1', 'COD-CANCELADO', { cancelado: true }),
        cheque('x2', 'COD-CERO', { subtotal: '0', impuestos: '0', total: '0', pagos: [] }),
        cheque('x3', 'COD-NEGATIVO', { total: '-10.00' }),
      ]);
      for (const folio of ['COD-CANCELADO', 'COD-CERO', 'COD-NEGATIVO']) {
        expect(await chequeDe(folio)).toBeTruthy();
        expect(await codigoDe(folio)).toBeNull();
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('colisiones y fallas: el código NUNCA tumba la venta', () => {
    it('colisión: si el primer código ya existe, se guarda el siguiente', async () => {
      await lote(KEYS.a1, [cheque('k1', 'COD-OCUPA')]);
      const ocupado = (await codigoDe('COD-OCUPA'))!.codigo;
      const libre = generarCodigo();
      generador.reiniciar();
      generador.cola = [ocupado, libre];
      expect(await lote(KEYS.a1, [cheque('k2', 'COD-CHOCA')])).toEqual({
        procesados: ['k2'],
        rechazados: [],
      });
      expect((await codigoDe('COD-CHOCA'))!.codigo).toBe(libre);
      expect(generador.llamadas).toBe(2);
      expect((await codigoDe('COD-OCUPA'))!.codigo).toBe(ocupado);
    });

    it(`${INTENTOS_CODIGO} colisiones seguidas: el cheque se guarda SIN código y el evento sale procesado`, async () => {
      await lote(KEYS.a1, [cheque('k3', 'COD-OCUPA-2')]);
      const ocupado = (await codigoDe('COD-OCUPA-2'))!.codigo;
      generador.cola = Array(INTENTOS_CODIGO).fill(ocupado);
      generador.llamadas = 0;
      expect(await lote(KEYS.a1, [cheque('k4', 'COD-SIN-LUGAR')])).toEqual({
        procesados: ['k4'],
        rechazados: [],
      });
      expect(generador.llamadas).toBe(INTENTOS_CODIGO);
      const c = await chequeDe('COD-SIN-LUGAR');
      expect(c.partidas).toHaveLength(1);
      expect(c.pagos).toHaveLength(1);
      expect(await codigoDe('COD-SIN-LUGAR')).toBeNull();
    });

    it('el generador truena: el cheque, sus partidas y sus pagos se guardan; el log no lleva el total', async () => {
      generador.falla = new Error('generador roto (sintético)');
      expect(await lote(KEYS.a1, [cheque('g1', 'COD-ROTO')])).toEqual({
        procesados: ['g1'],
        rechazados: [],
      });
      const c = await chequeDe('COD-ROTO');
      expect(c.total.toFixed(2)).toBe('315.50');
      expect(c.partidas).toHaveLength(1);
      expect(c.pagos).toHaveLength(1);
      expect(await codigoDe('COD-ROTO')).toBeNull();
      const log = errores.find((e) => e.includes('COD-ROTO'));
      expect(log).toContain('SIN código');
      expect(log).toContain('generador roto');
      expect(log).not.toContain('315.50');
    });

    it('un código fuera de formato lo rechaza el CHECK de la BASE; la transacción sigue viva y el cheque se guarda', async () => {
      generador.cola = ['OOOOOOOOO']; // O no está en el alfabeto: sólo la base lo puede rechazar
      expect(await lote(KEYS.a1, [cheque('f1', 'COD-FORMATO')])).toEqual({
        procesados: ['f1'],
        rechazados: [],
      });
      const c = await chequeDe('COD-FORMATO');
      expect(c.partidas).toHaveLength(1);
      expect(c.pagos).toHaveLength(1);
      expect(await codigoDe('COD-FORMATO')).toBeNull();
      const log = errores.find((e) => e.includes('COD-FORMATO'))!;
      expect(log).toContain('23514'); // check_violation de Postgres
      expect(log).not.toContain('OOOOOOOOO');
      expect(log).not.toContain('315.50');
    });

    it('tras la falla, el siguiente reenvío idéntico con el generador sano crea el código sin tocar el cheque', async () => {
      generador.falla = new Error('generador roto (sintético)');
      await lote(KEYS.a1, [cheque('h1', 'COD-CURA')]);
      expect(await codigoDe('COD-CURA')).toBeNull();
      const chequeAntes = JSON.stringify(await chequeDe('COD-CURA'));

      generador.falla = null;
      expect(await lote(KEYS.a1, [cheque('h1', 'COD-CURA')])).toEqual({
        procesados: ['h1'],
        rechazados: [],
      });
      expect(JSON.stringify(await chequeDe('COD-CURA'))).toBe(chequeAntes);
      const cod = await codigoDe('COD-CURA');
      expect(cod).not.toBeNull();
      expect(cod!.expiraAt.toISOString()).toBe(FIN_DE_SEPTIEMBRE);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('concurrencia: dos lotes en vuelo dejan UN código', () => {
    it('cheque nuevo, el mismo lote 3 veces en paralelo', async () => {
      const eventos = [cheque('p1', 'COD-PAR-1'), cheque('p2', 'COD-PAR-2')];
      const respuestas = await Promise.all(
        [1, 2, 3].map(() =>
          request(url).post('/ingesta/eventos').set('X-Api-Key', KEYS.a1).send({ eventos }),
        ),
      );
      for (const res of respuestas) {
        expect(res.status).toBe(200);
        // Choque de upsert entre lotes = rechazo reintentable (F1-031); nunca por el código.
        expect(
          (res.body as { rechazados: { reintentable: boolean }[] }).rechazados.every(
            (x) => x.reintentable,
          ),
        ).toBe(true);
      }
      for (const folioSr of ['COD-PAR-1', 'COD-PAR-2']) {
        expect(
          await prisma.codigoFacturacion.count({
            where: { cheque: { sucursalId: FX.sucursalA1, folioSr } },
          }),
        ).toBe(1);
      }
    });

    it('cheque ANTERIOR a la migración (sin código), dos reenvíos idénticos en paralelo: un código y ningún rechazo', async () => {
      await lote(KEYS.a1, [cheque('v1', 'COD-VIEJO')]);
      await prisma.codigoFacturacion.deleteMany({
        where: { cheque: { sucursalId: FX.sucursalA1, folioSr: 'COD-VIEJO' } },
      });
      const respuestas = await Promise.all(
        [1, 2].map(() =>
          request(url)
            .post('/ingesta/eventos')
            .set('X-Api-Key', KEYS.a1)
            .send({ eventos: [cheque('v1', 'COD-VIEJO')] }),
        ),
      );
      for (const res of respuestas) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ procesados: ['v1'], rechazados: [] });
      }
      expect(
        await prisma.codigoFacturacion.count({
          where: { cheque: { sucursalId: FX.sucursalA1, folioSr: 'COD-VIEJO' } },
        }),
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('constraints de la base', () => {
    const esperarSql = async (op: Promise<unknown>, ...fragmentos: string[]) => {
      const err = (await op.then(
        () => null,
        (e: unknown) => e,
      )) as Error | null;
      expect(err).not.toBeNull();
      for (const f of fragmentos) expect(err!.message).toContain(f);
    };

    it('código repetido: lo rechaza la unique global (aunque sea de otra empresa)', async () => {
      await lote(KEYS.a1, [cheque('u1', 'COD-UNICO')]);
      await lote(KEYS.b1, [cheque('u2', 'COD-UNICO-B')]);
      const a = (await codigoDe('COD-UNICO'))!;
      const b = (await codigoDe('COD-UNICO-B', FX.sucursalB1))!;
      await esperarSql(
        prisma.$executeRaw`UPDATE codigos_facturacion SET codigo = ${a.codigo} WHERE id = ${b.id}::uuid`,
        // Una violación de unique (23505) no trae el nombre del constraint en el mensaje: se
        // identifica por sus columnas, que salen igual en cualquier idioma del servidor.
        '23505',
        '(codigo)',
      );
    });

    it('un segundo código para el mismo cheque: lo rechaza la unique por cheque', async () => {
      const a = (await codigoDe('COD-UNICO'))!;
      await esperarSql(
        prisma.$executeRaw`
          INSERT INTO codigos_facturacion (id, codigo, cheque_id, sucursal_id, empresa_id, expira_at, updated_at)
          VALUES (${randomUUID()}::uuid, ${generarCodigo()}, ${a.chequeId}::uuid, ${a.sucursalId}::uuid,
            ${a.empresaId}::uuid, now(), now())`,
        '23505',
        '(cheque_id, empresa_id)',
      );
    });

    it.each([['OOOOOOOOO'], ['7jqrecp3u'], ['7JQRECP3'], ['7JQRECP3UU']])(
      'formato %s: lo rechaza el CHECK',
      async (malo) => {
        const a = (await codigoDe('COD-UNICO'))!;
        await esperarSql(
          prisma.$executeRaw`UPDATE codigos_facturacion SET codigo = ${malo} WHERE id = ${a.id}::uuid`,
          'codigos_facturacion_codigo_formato_check',
        );
      },
    );

    it('un código con la empresa de otro cheque: lo rechaza la FK compuesta', async () => {
      const b = (await codigoDe('COD-UNICO-B', FX.sucursalB1))!;
      await esperarSql(
        prisma.$executeRaw`UPDATE codigos_facturacion SET empresa_id = ${FX.empresaA}::uuid WHERE id = ${b.id}::uuid`,
        'codigos_facturacion_',
      );
    });

    it('vigencia: dias sin la regla dias, o fuera de 1..366, la rechaza el CHECK', async () => {
      for (const [regla, dias] of [
        ['fin_de_mes', 3],
        ['dias', null],
        ['dias', 0],
        ['dias', 367],
      ] as const) {
        await esperarSql(
          prisma.$executeRaw`
            INSERT INTO configuraciones_facturacion (id, empresa_id, vigencia_codigos, vigencia_dias, updated_at)
            VALUES (${randomUUID()}::uuid, ${FX.empresaB}::uuid, ${regla}::"ReglaVigenciaCodigo", ${dias}, now())`,
          'configuraciones_facturacion_vigencia_check',
        );
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /facturacion/codigo/:codigo (pública)', () => {
    const DATOS_DEL_TICKET = ['A1', '315.50', 'COD-PUB', 'T-COD-PUB', 'MESERO', 'Platillo'];

    /** Ninguna parte de la respuesta menciona la sucursal, el total, el folio ni las partidas. */
    const sinDatos = (texto: string) => {
      for (const dato of DATOS_DEL_TICKET) expect(texto).not.toContain(dato);
    };

    let codigo: string;
    beforeAll(async () => {
      // Sólo para esta sección: se crea con el generador real.
      generador.reiniciar();
      await lote(KEYS.a1, [cheque('pub', 'COD-PUB')]);
      codigo = (await codigoDe('COD-PUB'))!.codigo;
    });
    const volver = () =>
      prisma.codigoFacturacion.updateMany({
        where: { codigo },
        data: { estado: 'pendiente' },
      });
    afterEach(volver);

    it('pendiente: estado, mensaje y los datos NO sensibles del ticket; sin sesión', async () => {
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      const res = await consultar(codigo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        codigo,
        estado: 'pendiente',
        mensaje: 'El ticket se puede facturar.',
        periodoGlobal: null,
        ticket: {
          sucursal: 'A1',
          fecha: '2026-09-15T20:00:00.000Z',
          zonaHoraria: 'America/Mexico_City',
          total: '315.50',
          expiraAt: FIN_DE_SEPTIEMBRE,
        },
      });
      // Ni folio, ni mesa, ni mesero, ni partidas, ni pagos.
      expect(res.text).not.toContain('T-COD-PUB');
      expect(res.text).not.toContain('MESERO');
      expect(res.text).not.toContain('Platillo');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('minúsculas y espacios alrededor se normalizan', async () => {
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      const res = await consultar(`  ${codigo.toLowerCase()} `);
      expect(res.status).toBe(200);
      expect(res.body.codigo).toBe(codigo);
    });

    it('expirado (reloj del servidor en expira_at): sólo el estado, sin datos del ticket', async () => {
      reloj.t = Date.parse(FIN_DE_SEPTIEMBRE);
      const res = await consultar(codigo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        codigo,
        estado: 'expirado',
        mensaje: 'El plazo para facturar este ticket ya venció.',
        periodoGlobal: null,
        ticket: null,
      });
      sinDatos(res.text);
      // Un milisegundo antes seguía pendiente.
      reloj.t = Date.parse(FIN_DE_SEPTIEMBRE) - 1;
      expect((await consultar(codigo)).body.estado).toBe('pendiente');
    });

    it.each([
      ['facturado', 'Este ticket ya fue facturado.'],
      [
        'en_global',
        'Este ticket ya se incluyó en la factura global del periodo y no se puede facturar.',
      ],
      ['expirado', 'El plazo para facturar este ticket ya venció.'],
    ] as const)('%s guardado: sólo el estado, sin datos del ticket', async (estado, mensaje) => {
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      await prisma.codigoFacturacion.updateMany({ where: { codigo }, data: { estado } });
      const res = await consultar(codigo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ codigo, estado, mensaje, periodoGlobal: null, ticket: null });
      sinDatos(res.text);
    });

    it('cuenta cancelada DESPUÉS de tener código: cancelado, sin datos; la fila del código no cambia', async () => {
      await lote(KEYS.a1, [cheque('cx1', 'COD-SE-CANCELA')]);
      const antes = (await codigoDe('COD-SE-CANCELA'))!;
      await lote(KEYS.a1, [cheque('cx2', 'COD-SE-CANCELA', { cancelado: true })]);
      expect(await codigoDe('COD-SE-CANCELA')).toEqual(antes);
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      const res = await consultar(antes.codigo);
      expect(res.body).toEqual({
        codigo: antes.codigo,
        estado: 'cancelado',
        mensaje: 'La cuenta de este ticket fue cancelada y no se puede facturar.',
        periodoGlobal: null,
        ticket: null,
      });
      sinDatos(res.text);
    });

    it('inexistente: 404; formato inválido: 400 (distintos entre sí y de los estados)', async () => {
      let inexistente = generarCodigo();
      while (await prisma.codigoFacturacion.count({ where: { codigo: inexistente } })) {
        inexistente = generarCodigo();
      }
      const no = await consultar(inexistente);
      expect(no.status).toBe(404);
      expect(no.body).toMatchObject({ statusCode: 404, message: MENSAJE_CODIGO_NO_ENCONTRADO });

      for (const malo of ['7JQRECP3O', 'ABC', 'AAAAAAAAAA', '7JQR-CP3U']) {
        const res = await consultar(malo);
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual([MENSAJE_CODIGO_FORMATO]);
      }
    });

    it('el código de ejemplo 7JQRECP3U tiene el formato: si no existe da 404, no 400', async () => {
      const existe = await prisma.codigoFacturacion.count({ where: { codigo: CODIGO_EJEMPLO } });
      const res = await consultar(CODIGO_EJEMPLO);
      expect(res.status).toBe(existe ? 200 : 404);
    });

    it('sucursal o empresa dadas de baja: 404 idéntico al de inexistente', async () => {
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      const inexistente = await consultar('ZZZZZZZZZ');
      for (const [baja, alta] of [
        [
          () => prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { activo: false } }),
          () => prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { activo: true } }),
        ],
        [
          () => prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: false } }),
          () => prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: true } }),
        ],
      ] as const) {
        await baja();
        try {
          const res = await consultar(codigo);
          expect(res.status).toBe(404);
          expect(res.body).toEqual(inexistente.body);
        } finally {
          await alta();
        }
      }
      expect((await consultar(codigo)).status).toBe(200);
    });

    it('rate limit: 10 por minuto por IP; la 11.ª de esa IP es 429 y otra IP sigue pasando', async () => {
      reloj.t = Date.parse('2026-09-20T12:00:00Z');
      for (let i = 0; i < 10; i++) {
        const res = await consultar(codigo, '203.0.113.7');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit-codigo-facturacion']).toBe('10');
      }
      expect((await consultar(codigo, '203.0.113.7')).status).toBe(429);
      // También un código inválido o inexistente gasta (y respeta) el límite.
      expect((await consultar('ZZZZZZZZZ', '203.0.113.7')).status).toBe(429);
      expect((await consultar(codigo, '203.0.113.8')).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('vigencia por empresa: GET / PUT /facturacion/vigencia-codigos', () => {
    const get = async (u: Usuario, empresaId: string) =>
      request(url)
        .get('/facturacion/vigencia-codigos')
        .query({ empresaId })
        .set('Authorization', `Bearer ${await token(u)}`);
    const put = async (u: Usuario, body: object) =>
      request(url)
        .put('/facturacion/vigencia-codigos')
        .set('Authorization', `Bearer ${await token(u)}`)
        .send(body);

    afterAll(async () => {
      await prisma.configuracionFacturacion.deleteMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
      });
    });

    it('sin configurar: fin de mes (configurada = false)', async () => {
      const res = await get(USUARIOS.adminEmpresaA, FX.empresaA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ regla: 'fin_de_mes', dias: null, configurada: false });
    });

    it('404 para una empresa ajena, con el MISMO cuerpo que una inexistente, en GET y en PUT', async () => {
      const g1 = await get(USUARIOS.adminEmpresaA, FX.empresaB);
      const g2 = await get(USUARIOS.adminEmpresaA, FX.inexistente);
      expect(g1.status).toBe(404);
      expect(g1.body).toEqual(g2.body);

      const p1 = await put(USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaB,
        regla: 'dias',
        dias: 3,
      });
      const p2 = await put(USUARIOS.adminEmpresaA, {
        empresaId: FX.inexistente,
        regla: 'dias',
        dias: 3,
      });
      expect(p1.status).toBe(404);
      expect(p1.body).toEqual(p2.body);
      expect(
        await prisma.configuracionFacturacion.count({ where: { empresaId: FX.empresaB } }),
      ).toBe(0);
    });

    it('403 para el visor, en GET y en PUT; 401 sin token', async () => {
      expect((await get(USUARIOS.visorA, FX.empresaA)).status).toBe(403);
      expect(
        (await put(USUARIOS.visorA, { empresaId: FX.empresaA, regla: 'fin_de_mes' })).status,
      ).toBe(403);
      expect(
        (await request(url).get('/facturacion/vigencia-codigos').query({ empresaId: FX.empresaA }))
          .status,
      ).toBe(401);
    });

    it.each([
      [{ regla: 'dias' }],
      [{ regla: 'dias', dias: 0 }],
      [{ regla: 'dias', dias: 367 }],
      [{ regla: 'dias', dias: 2.5 }],
      [{ regla: 'fin_de_mes', dias: 3 }],
      [{ regla: 'semanal' }],
    ])('400 con %j y no guarda nada', async (cuerpo) => {
      const res = await put(USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, ...cuerpo });
      expect(res.status).toBe(400);
      expect(
        await prisma.configuracionFacturacion.count({ where: { empresaId: FX.empresaA } }),
      ).toBe(0);
    });

    it('dias = 3 aplica a los códigos NUEVOS de ESA empresa; los viejos y los de otra empresa no cambian', async () => {
      await lote(KEYS.a1, [cheque('vg1', 'COD-VIG-ANTES')]);
      const viejo = await codigoDe('COD-VIG-ANTES');

      const res = await put(USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaA,
        regla: 'dias',
        dias: 3,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ regla: 'dias', dias: 3, configurada: true });
      expect((await get(USUARIOS.adminGlobal, FX.empresaA)).body).toEqual(res.body);

      await lote(KEYS.a1, [cheque('vg2', 'COD-VIG-DESPUES')]);
      await lote(KEYS.b1, [cheque('vg3', 'COD-VIG-B')]);
      // 15 de septiembre + 3 días → vence el 19 de septiembre 00:00 CDMX.
      expect((await codigoDe('COD-VIG-DESPUES'))!.expiraAt.toISOString()).toBe(
        '2026-09-19T06:00:00.000Z',
      );
      expect((await codigoDe('COD-VIG-B', FX.sucursalB1))!.expiraAt.toISOString()).toBe(
        FIN_DE_SEPTIEMBRE,
      );
      expect(await codigoDe('COD-VIG-ANTES')).toEqual(viejo);

      // De regreso a fin de mes: actualiza la MISMA fila.
      const otra = await put(USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaA,
        regla: 'fin_de_mes',
      });
      expect(otra.body).toEqual({ regla: 'fin_de_mes', dias: null, configurada: true });
      expect(
        await prisma.configuracionFacturacion.count({ where: { empresaId: FX.empresaA } }),
      ).toBe(1);
    });
  });

  it('las columnas del código son dato NUESTRO: la ingesta no expone ni acepta el código', async () => {
    // Un agente no puede mandar su propio código (el DTO lo rechaza por whitelist).
    const r = await lote(KEYS.a1, [
      {
        ...cheque('n1', 'COD-NO-ACEPTA'),
        datos: { ...cheque('n1', 'x').datos, folioSr: 'COD-NO-ACEPTA', codigo: CODIGO_EJEMPLO },
      },
    ]);
    expect(r.procesados).toEqual([]);
    expect(r.rechazados).toEqual([expect.objectContaining({ id: 'n1', reintentable: false })]);
  });
});
