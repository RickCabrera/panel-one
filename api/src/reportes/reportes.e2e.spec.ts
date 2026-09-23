import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { EstadoEnvioReporte, PrismaClient, TipoReporte } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import type { PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import type { ProductoTop, VentaDia, VentaSucursal } from '../ventas/agregados-ventas.service';
import { fechaLarga, formatoPesos } from './formato';
import { ReportesService } from './reportes.service';

// E2E de los reportes programados (F2-141) sobre la app REAL, Postgres REAL, correo FALSO
// (CORREO_DIR_FALSO a un temporal) y reloj fijo que el test mueve.
//
// Empresa A: A1 y A2 en CDMX (UTC−6 todo el año). Empresa B: B1 en Tijuana (UTC−7 en
// septiembre, con horario de verano). 07:00 CDMX = 13:00Z; 07:00 Tijuana = 14:00Z.
//
// Ventas de A, escritas a mano (las cifras "a mano" de abajo salen de aquí, NO del código):
// - Lunes 21-sep (el "ayer" del martes), A1: 100.00 + 250.50 + 49.50 = 400.00 en 3 cuentas,
//   más una cancelada de 999.00 que no suma. A2: nada.
//   Partidas: Taco 60.00 + 150.00 = 210.00 · Cerveza 100.50 · Agua 40.00 + 49.50 = 89.50.
// - Semana 14–20 sep: A1 200.00 (15) + 100.00 (20) = 300.00; A2 50.00 (17). Total 350.00.
// - Semana 7–13 sep: A1 150.00 (9); A2 nada. Total 150.00 → +200.00, +133.33 %.
// - B1: 70.00 el domingo 20 a las 13:00 Tijuana.

const Z = (s: string) => Date.parse(s);

class RelojFijo extends Reloj {
  t = 0;
  override ahora(): number {
    return this.t;
  }
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type CorreoGuardado = {
  destinatario: { email: string };
  plantilla: PlantillaCorreo;
  empresaId: string;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Una fila de tabla con esas celdas seguidas (los estilos en línea se ignoran). */
const fila = (...celdas: string[]) => new RegExp(`>${celdas.map(esc).join('</td><td[^>]*>')}</td>`);

describe('Reportes programados por correo (e2e, F2-141)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  const directorio = mkdtempSync(join(tmpdir(), 'f2-141-correos-'));
  const dirPrevio = process.env.CORREO_DIR_FALSO;
  let app: INestApplication;
  let servicio: ReportesService;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (ruta: string, query: object, u: Usuario = USUARIOS.visorA) =>
    request(app.getHttpServer())
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const put = async (body: object, u: Usuario) =>
    request(app.getHttpServer())
      .put('/cuenta/reportes')
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);
  const baja = (body: object) => request(app.getHttpServer()).post('/reportes/baja').send(body);

  async function cheque(
    sucursalId: string,
    folio: string,
    cerrado: string,
    total: string,
    partidas: Array<[string, string, string]> = [],
    cancelado = false,
  ) {
    const empresaId = sucursalId === FX.sucursalB1 ? FX.empresaB : FX.empresaA;
    const c = await prisma.cheque.create({
      data: {
        empresaId,
        sucursalId,
        folio,
        folioSr: `F2141-${folio}`,
        abiertoAt: new Date(Z(cerrado) - 30 * 60_000),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total,
        cancelado,
      },
    });
    if (partidas.length > 0) {
      await prisma.chequePartida.createMany({
        data: partidas.map(([producto, cantidad, importe], orden) => ({
          chequeId: c.id,
          empresaId,
          orden,
          producto,
          cantidad,
          precioUnit: importe,
          total: importe,
        })),
      });
    }
  }

  /** Los envíos de una suscripción, por (usuario, empresa). */
  async function envios(u: Usuario, empresaId: string, tipo?: TipoReporte) {
    return prisma.envioReporte.findMany({
      where: { suscripcion: { usuarioId: u.id, empresaId }, ...(tipo ? { tipo } : {}) },
      orderBy: [{ periodo: 'asc' }, { tipo: 'asc' }],
    });
  }

  function leerCorreo(correoId: string | null): CorreoGuardado {
    expect(correoId).not.toBeNull();
    return JSON.parse(
      readFileSync(join(directorio, correoId!, 'correo.json'), 'utf8'),
    ) as CorreoGuardado;
  }

  async function correoDe(u: Usuario, empresaId: string, tipo: TipoReporte, periodo: string) {
    const [e] = (await envios(u, empresaId, tipo)).filter((x) => x.periodo === periodo);
    expect(e?.estado).toBe(EstadoEnvioReporte.enviado);
    return leerCorreo(e.correoId);
  }

  async function vuelta(en: string) {
    reloj.t = Z(en);
    return servicio.vuelta();
  }

  beforeAll(async () => {
    process.env.CORREO_DIR_FALSO = directorio;
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.updateMany({
      where: { id: { in: [FX.sucursalA1, FX.sucursalA2] } },
      data: { zonaHoraria: 'America/Mexico_City' },
    });
    await prisma.sucursal.update({
      where: { id: FX.sucursalB1 },
      data: { zonaHoraria: 'America/Tijuana' },
    });

    await cheque(FX.sucursalA1, 'L1', '2026-09-21T18:00:00Z', '100.00', [
      ['Taco', '2', '60.00'],
      ['Agua', '1', '40.00'],
    ]);
    await cheque(FX.sucursalA1, 'L2', '2026-09-21T19:00:00Z', '250.50', [
      ['Taco', '5', '150.00'],
      ['Cerveza', '2', '100.50'],
    ]);
    await cheque(FX.sucursalA1, 'L3', '2026-09-21T20:00:00Z', '49.50', [['Agua', '1', '49.50']]);
    await cheque(FX.sucursalA1, 'LX', '2026-09-21T21:00:00Z', '999.00', [], true);
    await cheque(FX.sucursalA1, 'S15', '2026-09-15T18:00:00Z', '200.00');
    await cheque(FX.sucursalA1, 'S20', '2026-09-20T18:00:00Z', '100.00');
    await cheque(FX.sucursalA2, 'S17', '2026-09-17T18:00:00Z', '50.00');
    await cheque(FX.sucursalA1, 'P09', '2026-09-09T18:00:00Z', '150.00');
    await cheque(FX.sucursalB1, 'B20', '2026-09-20T20:00:00Z', '70.00');
    // Una alerta abierta de A (desde el domingo), para ver la sección de alertas llena.
    await prisma.alerta.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        tipo: 'mesa_abierta',
        severidad: 'advertencia',
        llave: 'F2141',
        llaveAbierta: 'F2141',
        umbral: 60,
        detalle: {},
        abiertaAt: new Date('2026-09-20T23:00:00Z'),
      },
    });

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
    servicio = app.get(ReportesService);
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
    if (dirPrevio === undefined) delete process.env.CORREO_DIR_FALSO;
    else process.env.CORREO_DIR_FALSO = dirPrevio;
    rmSync(directorio, { recursive: true, force: true });
  });

  // ------------------------------------------------------------- suscripción

  describe('suscripción propia (GET/PUT /cuenta/reportes)', () => {
    it('sin suscripción: los dos apagados, con la zona y la hora de la empresa', async () => {
      reloj.t = Z('2026-09-21T12:00:00Z');
      const r = await get('/cuenta/reportes', { empresaId: FX.empresaA });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        empresaId: FX.empresaA,
        diario: false,
        semanal: false,
        zonaHoraria: 'America/Mexico_City',
        horaEnvio: 7,
        ultimosEnvios: [],
      });
    });

    it('visor, admin_global y otro visor guardan cada quien la suya', async () => {
      const a = await put({ empresaId: FX.empresaA, diario: true, semanal: true }, USUARIOS.visorA);
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ diario: true, semanal: true });
      const g = await put(
        { empresaId: FX.empresaA, diario: true, semanal: false },
        USUARIOS.adminGlobal,
      );
      expect(g.status).toBe(200);
      const b = await put(
        { empresaId: FX.empresaB, diario: true, semanal: false },
        USUARIOS.visorB,
      );
      expect(b.status).toBe(200);
      expect(b.body.zonaHoraria).toBe('America/Tijuana');
      // Guardar dos veces no duplica: una fila por (usuario, empresa).
      await put({ empresaId: FX.empresaA, diario: true, semanal: true }, USUARIOS.visorA);
      expect(
        await prisma.suscripcionReporte.count({ where: { usuarioId: USUARIOS.visorA.id } }),
      ).toBe(1);
    });

    it('empresa ajena = 404 idéntico a inexistente, en GET, PUT y vista previa', async () => {
      const ajena = await get('/cuenta/reportes', { empresaId: FX.empresaB });
      const inexistente = await get('/cuenta/reportes', { empresaId: FX.inexistente });
      expect(ajena.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
      expect(
        (await put({ empresaId: FX.empresaB, diario: true, semanal: true }, USUARIOS.visorA))
          .status,
      ).toBe(404);
      const previa = await get('/cuenta/reportes/vista-previa', {
        empresaId: FX.empresaB,
        tipo: 'diario',
      });
      const previaInexistente = await get('/cuenta/reportes/vista-previa', {
        empresaId: FX.inexistente,
        tipo: 'diario',
      });
      expect(previa.status).toBe(404);
      expect(previa.body).toEqual(previaInexistente.body);
      // admin_empresa de A tampoco ve B.
      expect(
        (await get('/cuenta/reportes', { empresaId: FX.empresaB }, USUARIOS.adminEmpresaA)).status,
      ).toBe(404);
      expect(
        await prisma.suscripcionReporte.count({
          where: { usuarioId: USUARIOS.visorA.id, empresaId: FX.empresaB },
        }),
      ).toBe(0);
    });

    it('sin empresaId, con tipo inválido o sin token: 400 / 401', async () => {
      expect((await get('/cuenta/reportes', {}, USUARIOS.adminGlobal)).status).toBe(400);
      expect(
        (await get('/cuenta/reportes/vista-previa', { empresaId: FX.empresaA, tipo: 'mensual' }))
          .status,
      ).toBe(400);
      expect(
        (await put({ empresaId: FX.empresaA, diario: 'si', semanal: true }, USUARIOS.visorA))
          .status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get('/cuenta/reportes')
            .query({ empresaId: FX.empresaA })
        ).status,
      ).toBe(401);
    });

    it('suscripciones que NO deben recibir: usuario inactivo y usuario que ya no ve la empresa', async () => {
      // Se escriben directo (por la API no se pueden crear): así quedan si el usuario se
      // desactivó o cambió de empresa después de suscribirse.
      await prisma.suscripcionReporte.createMany({
        data: [
          { usuarioId: USUARIOS.visorInactivo.id, empresaId: FX.empresaA, diario: true },
          { usuarioId: USUARIOS.visorB.id, empresaId: FX.empresaA, diario: true },
        ],
      });
    });
  });

  // ------------------------------------------------------------- hora y cifras

  describe('envío a la hora correcta en la zona de la empresa', () => {
    it('06:59 CDMX del lunes: no sale nada', async () => {
      expect(await vuelta('2026-09-21T12:59:59Z')).toEqual({ enviados: 0, fallidos: 0 });
      expect(
        await prisma.envioReporte.count({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        }),
      ).toBe(0);
    });

    it('07:00 CDMX del lunes: diario y semanal a A; Tijuana todavía no', async () => {
      const r = await vuelta('2026-09-21T13:00:00Z');
      // visorA: diario + semanal; adminGlobal: diario. visorB-en-A: descartado.
      expect(r).toEqual({ enviados: 3, fallidos: 1 });
      expect(
        (await envios(USUARIOS.visorA, FX.empresaA)).map((e) => [e.tipo, e.periodo, e.estado]),
      ).toEqual([
        ['semanal', '2026-09-14', 'enviado'],
        ['diario', '2026-09-20', 'enviado'],
      ]);
      expect(await envios(USUARIOS.visorB, FX.empresaB)).toEqual([]);
      expect(await envios(USUARIOS.visorInactivo, FX.empresaA)).toEqual([]);
      const [ajena] = await envios(USUARIOS.visorB, FX.empresaA);
      expect(ajena).toMatchObject({ estado: 'descartado', correoId: null });
      // Nadie recibió un correo de A que no debía.
      const destinatarios = await prisma.correoEnviado.findMany({
        where: { empresaId: FX.empresaA },
        select: { destinatario: true },
      });
      expect(destinatarios.map((d) => d.destinatario).sort()).toEqual(
        [USUARIOS.adminGlobal.email, USUARIOS.visorA.email, USUARIOS.visorA.email].sort(),
      );
    });

    it('otra vuelta el mismo día no duplica ni reintenta el descartado', async () => {
      expect(await vuelta('2026-09-21T13:05:00Z')).toEqual({ enviados: 0, fallidos: 0 });
      const [ajena] = await envios(USUARIOS.visorB, FX.empresaA);
      expect(ajena.intentos).toBe(1);
    });

    it('07:00 Tijuana (14:00Z) sale el de B, con el domingo de SU zona', async () => {
      expect(await vuelta('2026-09-21T13:59:59Z')).toEqual({ enviados: 0, fallidos: 0 });
      expect(await vuelta('2026-09-21T14:00:00Z')).toEqual({ enviados: 1, fallidos: 0 });
      const correo = await correoDe(USUARIOS.visorB, FX.empresaB, 'diario', '2026-09-20');
      expect(correo.destinatario.email).toBe(USUARIOS.visorB.email);
      expect(correo.empresaId).toBe(FX.empresaB);
      expect(correo.plantilla.html).toMatch(fila('B1', '$70.00', '1', '$70.00'));
      // 23:59 CDMX del lunes (22:59 Tijuana): todo lo de hoy ya salió; nada más.
      expect(await vuelta('2026-09-22T05:59:00Z')).toEqual({ enviados: 0, fallidos: 0 });
    });

    it('el semanal cuadra con el panel (dos semanas, por sucursal y por día) y a mano', async () => {
      const { plantilla } = await correoDe(USUARIOS.visorA, FX.empresaA, 'semanal', '2026-09-14');
      const html = plantilla.html;
      expect(plantilla.asunto).toBe(
        'Resumen semanal del 14 sep al 20 sep · Empresa Prueba A (F1-011)',
      );

      const semana = { empresaId: FX.empresaA, desde: '2026-09-14', hasta: '2026-09-20' };
      const previa = { empresaId: FX.empresaA, desde: '2026-09-07', hasta: '2026-09-13' };
      const actual = (await get('/ventas/comparativo-sucursales', semana)).body as VentaSucursal[];
      const anterior = (await get('/ventas/comparativo-sucursales', previa))
        .body as VentaSucursal[];
      const resumen = (await get('/ventas/resumen', semana)).body as { venta: string };
      const resumenAnt = (await get('/ventas/resumen', previa)).body as { venta: string };

      // A mano, sobre los cheques escritos arriba: el panel dice lo mismo que la cuenta.
      expect(resumen.venta).toBe('350.00');
      expect(resumenAnt.venta).toBe('150.00');
      expect(actual.map((s) => [s.nombre, s.venta])).toEqual([
        ['A1', '300.00'],
        ['A2', '50.00'],
      ]);

      expect(html).toContain(`Venta de la semana: <strong>${formatoPesos(resumen.venta)}</strong>`);
      expect(html).toContain(
        `Semana anterior: ${formatoPesos(resumenAnt.venta)} · diferencia +$200.00 (+133.33 %)`,
      );
      const a1 = actual.find((s) => s.nombre === 'A1')!;
      const a1Ant = anterior.find((s) => s.nombre === 'A1')!;
      expect(html).toMatch(
        fila('A1', formatoPesos(a1.venta), formatoPesos(a1Ant.venta), '+$150.00', '+100.00 %'),
      );
      // A2 no vendió la semana anterior: "—", no −100 % ni +∞.
      const a2 = actual.find((s) => s.nombre === 'A2')!;
      expect(html).toMatch(fila('A2', formatoPesos(a2.venta), 'Sin ventas registradas', '—', '—'));

      const dias = (await get('/ventas/por-dia', semana)).body as VentaDia[];
      const diasAnt = (await get('/ventas/por-dia', previa)).body as VentaDia[];
      expect(dias).toHaveLength(7);
      dias.forEach((d, i) => {
        const celda = (x: VentaDia) =>
          x.cuentas === 0 ? 'Sin ventas registradas' : formatoPesos(x.venta);
        expect(html).toMatch(fila(fechaLarga(d.dia), celda(d), celda(diasAnt[i])));
      });
    });

    it('el martes: el diario cuadra con el panel (resumen, sucursales, top 5) y a mano', async () => {
      // El visorB-en-A vuelve a quedar descartado: cada día es un envío nuevo (ver abajo).
      expect(await vuelta('2026-09-22T13:00:00Z')).toEqual({ enviados: 2, fallidos: 1 });
      const { plantilla } = await correoDe(USUARIOS.visorA, FX.empresaA, 'diario', '2026-09-21');
      const html = plantilla.html;
      expect(plantilla.nombre).toBe('reporte-diario');
      expect(plantilla.asunto).toBe(
        'Resumen del lunes 21 de septiembre de 2026 · Empresa Prueba A (F1-011)',
      );

      const filtro = { empresaId: FX.empresaA, desde: '2026-09-21', hasta: '2026-09-21' };
      const resumen = (await get('/ventas/resumen', filtro)).body as {
        venta: string;
        cuentas: number;
        ticketPromedio: string;
      };
      const sucursales = (await get('/ventas/comparativo-sucursales', filtro))
        .body as VentaSucursal[];
      const top = (await get('/ventas/top-productos', { ...filtro, limite: 5 }))
        .body as ProductoTop[];

      // A mano: 100.00 + 250.50 + 49.50; la cancelada de 999.00 no suma.
      expect(resumen).toMatchObject({ venta: '400.00', cuentas: 3 });
      expect(top.map((p) => [p.producto, p.importe])).toEqual([
        ['Taco', '210.00'],
        ['Cerveza', '100.50'],
        ['Agua', '89.50'],
      ]);

      expect(html).toContain(`Venta total: <strong>${formatoPesos(resumen.venta)}</strong>`);
      expect(html).toContain(`3 cuentas · ticket promedio ${formatoPesos(resumen.ticketPromedio)}`);
      for (const s of sucursales) {
        expect(html).toMatch(
          s.cuentas === 0
            ? fila(s.nombre, 'Sin ventas registradas', '—', '—')
            : fila(
                s.nombre,
                formatoPesos(s.venta),
                String(s.cuentas),
                formatoPesos(s.ticketPromedio!),
              ),
        );
      }
      for (const p of top)
        expect(html).toMatch(fila(p.producto, formatoPesos(p.importe), p.cantidad));
      expect(html).toContain('1 abiertas ahora</strong>: Mesa abierta mucho tiempo: 1');
      // Enlace al panel en el periodo del reporte.
      expect(html).toContain(
        `/resumen?empresa=${FX.empresaA}&amp;periodo=rango&amp;desde=2026-09-21&amp;hasta=2026-09-21`,
      );
    });

    it('la vista previa arma el mismo correo que salió, sin mandar ni escribir nada', async () => {
      reloj.t = Z('2026-09-22T15:00:00Z');
      const antes = await prisma.envioReporte.count();
      const r = await get('/cuenta/reportes/vista-previa', {
        empresaId: FX.empresaA,
        tipo: 'diario',
      });
      expect(r.status).toBe(200);
      const salio = await correoDe(USUARIOS.visorA, FX.empresaA, 'diario', '2026-09-21');
      expect(r.body).toMatchObject({
        tipo: 'diario',
        periodo: '2026-09-21',
        asunto: salio.plantilla.asunto,
      });
      expect(r.body.html).toBe(salio.plantilla.html);
      expect(await prisma.envioReporte.count()).toBe(antes);
    });
  });

  // ------------------------------------------------------------- concurrencia y fallos

  describe('idempotencia y reintentos', () => {
    it('dos vueltas a la vez (dos réplicas) mandan UN correo por suscripción', async () => {
      reloj.t = Z('2026-09-23T13:00:00Z');
      const [a, b] = await Promise.all([servicio.vuelta(), servicio.vuelta()]);
      expect(a.enviados + b.enviados).toBe(2);
      for (const u of [USUARIOS.visorA, USUARIOS.adminGlobal]) {
        const e = (await envios(u, FX.empresaA, 'diario')).filter(
          (x) => x.periodo === '2026-09-22',
        );
        expect(e).toHaveLength(1);
      }
      expect(
        await prisma.correoEnviado.count({
          where: { empresaId: FX.empresaA, asunto: { contains: 'martes 22 de septiembre' } },
        }),
      ).toBe(2);
    });

    it('el puerto falla: queda fallido y la siguiente vuelta del mismo día lo reintenta', async () => {
      const puerto = app.get<PuertoCorreo>(PUERTO_CORREO);
      const espia = jest.spyOn(puerto, 'enviar').mockRejectedValue(new Error('Brevo caído'));
      try {
        expect(await vuelta('2026-09-24T13:00:00Z')).toEqual({ enviados: 0, fallidos: 3 });
      } finally {
        espia.mockRestore();
      }
      const [f] = (await envios(USUARIOS.visorA, FX.empresaA, 'diario')).filter(
        (x) => x.periodo === '2026-09-23',
      );
      expect(f).toMatchObject({ estado: 'fallido', intentos: 1, enviadoAt: null });
      expect(f.error).toContain('Brevo caído');

      expect(await vuelta('2026-09-24T13:01:00Z')).toEqual({ enviados: 2, fallidos: 0 });
      const [ok] = (await envios(USUARIOS.visorA, FX.empresaA, 'diario')).filter(
        (x) => x.periodo === '2026-09-23',
      );
      expect(ok).toMatchObject({ estado: 'enviado', intentos: 2, error: null });
    });

    it('tres fallos seguidos: descartado, y ya no se intenta más', async () => {
      const puerto = app.get<PuertoCorreo>(PUERTO_CORREO);
      const espia = jest.spyOn(puerto, 'enviar').mockRejectedValue(new Error('caído'));
      try {
        for (const hora of ['13:00', '13:01', '13:02', '13:03']) {
          await vuelta(`2026-09-25T${hora}:00Z`);
        }
        expect(espia).toHaveBeenCalledTimes(6); // 3 intentos × 2 suscripciones
      } finally {
        espia.mockRestore();
      }
      const [d] = (await envios(USUARIOS.visorA, FX.empresaA, 'diario')).filter(
        (x) => x.periodo === '2026-09-24',
      );
      expect(d).toMatchObject({ estado: 'descartado', intentos: 3 });
      // Con el puerto de vuelta, el día perdido no se recupera.
      expect(await vuelta('2026-09-25T13:10:00Z')).toEqual({ enviados: 0, fallidos: 0 });
    });
  });

  describe('destinatario que ya no ve la empresa', () => {
    it('cada día queda UN envío descartado, sin correo y sin reintento', async () => {
      const e = await envios(USUARIOS.visorB, FX.empresaA);
      expect(e.length).toBeGreaterThan(1);
      for (const x of e) {
        expect(x).toMatchObject({ estado: 'descartado', intentos: 1, correoId: null });
        expect(x.error).toContain('ya no puede ver');
      }
      expect(new Set(e.map((x) => x.periodo)).size).toBe(e.length);
      expect(
        await prisma.correoEnviado.count({
          where: { empresaId: FX.empresaA, destinatario: USUARIOS.visorB.email },
        }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------- baja sin sesión

  describe('baja desde el correo, sin sesión', () => {
    let enlace: URL;

    beforeAll(async () => {
      const { plantilla } = await correoDe(USUARIOS.visorA, FX.empresaA, 'diario', '2026-09-22');
      const href = /href="([^"]*\/reportes\/baja[^"]*)"/.exec(plantilla.html)![1];
      enlace = new URL(href.replace(/&amp;/g, '&'));
    });

    it('el enlace apunta a la página del panel, con el token y el tipo', () => {
      expect(enlace.pathname).toBe('/reportes/baja');
      expect(enlace.searchParams.get('tipo')).toBe('diario');
      expect(enlace.searchParams.get('t')).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    });

    it('un token alterado o de otra forma: 404, y no apaga nada', async () => {
      const t = enlace.searchParams.get('t')!;
      // Se altera un carácter de la MITAD de la firma, no el último: la firma son 32 bytes en
      // base64url (43 caracteres) y el último sólo lleva 4 bits útiles, así que cambiar su "A" por
      // "B" decodificaba a los mismos bytes y el token "alterado" seguía siendo válido (~1/16).
      const i = t.indexOf('.') + 20;
      const alterado = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
      const r = await baja({ token: alterado, tipo: 'diario' });
      expect(r.status).toBe(404);
      expect((await baja({ token: 'basura' })).status).toBe(404);
      expect((await baja({ token: t, tipo: 'mensual' })).status).toBe(400);
      const s = await prisma.suscripcionReporte.findFirstOrThrow({
        where: { usuarioId: USUARIOS.visorA.id, empresaId: FX.empresaA },
      });
      expect(s).toMatchObject({ diario: true, semanal: true });
    });

    it('POST sin Authorization apaga SÓLO ese reporte; repetirlo no cambia nada', async () => {
      const t = enlace.searchParams.get('t')!;
      const r = await baja({ token: t, tipo: 'diario' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ diario: false, semanal: true });
      const otra = await baja({ token: t, tipo: 'diario' });
      expect(otra.status).toBe(200);
      expect(otra.body).toEqual({ diario: false, semanal: true });
    });

    it('la siguiente vuelta ya no le manda el diario; a los demás, sí', async () => {
      expect(await vuelta('2026-09-26T13:00:00Z')).toEqual({ enviados: 1, fallidos: 1 });
      expect(
        (await envios(USUARIOS.visorA, FX.empresaA, 'diario')).some(
          (e) => e.periodo === '2026-09-25',
        ),
      ).toBe(false);
      expect(
        (await envios(USUARIOS.adminGlobal, FX.empresaA, 'diario')).some(
          (e) => e.periodo === '2026-09-25',
        ),
      ).toBe(true);
    });

    it('la ruta pública tiene su límite por IP (10/min): la siguiente es 429', async () => {
      let status = 0;
      for (let i = 0; i < 12 && status !== 429; i++) {
        status = (await baja({ token: 'basura' })).status;
      }
      expect(status).toBe(429);
    });

    it('GET /cuenta/reportes lo refleja, con sus últimos envíos', async () => {
      const r = await get('/cuenta/reportes', { empresaId: FX.empresaA });
      expect(r.body).toMatchObject({ diario: false, semanal: true });
      expect(r.body.ultimosEnvios.length).toBeGreaterThan(0);
      expect(r.body.ultimosEnvios[0]).toEqual(
        expect.objectContaining({ tipo: 'diario', periodo: '2026-09-24', estado: 'descartado' }),
      );
    });
  });
});
