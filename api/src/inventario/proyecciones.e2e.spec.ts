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

// E2E de Proyecciones y sugerido de compra (F2-127) sobre la app REAL contra Postgres REAL, con
// las fixtures sintéticas de F1-011. Pólizas, fotos y catálogos entran por las ingestas del
// agente; los mínimos se escriben directo (son del panel). Reloj FIJO. Los esperados están
// ESCRITOS A MANO abajo, no recalculados con la fórmula del API. La prueba contra el seed (el
// criterio de cierre) es `prisma/seed-proyecciones.spec.ts`.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-proyecciones-F2-127-sucursal-a1-00000001',
  a2: 'msr_sintetica-proyecciones-F2-127-sucursal-a2-00000002',
  b1: 'msr_sintetica-proyecciones-F2-127-sucursal-b1-00000003',
} as const;
/** Sucursal de la empresa A creada aquí, SIN pólizas (la borra `limpiarFixtures`). */
const A3 = 'f2127000-0000-4000-8000-0000000000a3';

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

const sinc = (n: number) => `f2127000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/*
 * HOY: 2026-09-16 (miércoles). AHORA = 18:00Z = 12:00 en CDMX (A1, UTC−6) y 11:00 en Tijuana (A2,
 * UTC−7): el mismo día local en las dos. Ventana = [08-19, 09-15]. Miércoles de la ventana: 09-09
 * (semana 1, peso 4), 09-02 (3), 08-26 (2), 08-19 (1). Jueves: 09-10, 09-03, … Martes: 09-15, ….
 *
 * A1 · ALM1
 * - I1 Carne (KG), inicial 08-01 +200. Demanda:
 *   · consumo 09-09 −10, 09-02 −20, 08-26 −30 y 08-19 00:30 local (= 06:30Z) −40 (miércoles)
 *   · jueves 09-10: merma −1 y traspaso_salida −0.5 = 1.5
 *   · martes 09-15 23:30 local (= 09-16 05:30Z, SIGUE siendo 09-15): consumo −7
 *   NO cuentan: ajuste 09-14 −100 · consumo CANCELADO 09-08 −100 · compra 09-03 +50 · consumo
 *   08-18 23:30 local (= 08-19 05:30Z; es 08-18, fuera de la ventana) −999 · consumo HOY 09-16 08:00
 *   local −999 · traspaso_entrada 09-11 +3 · un renglón POSITIVO en una póliza de consumo 09-02
 *   (+5, devolución): sólo las SALIDAS son demanda (no se netea: lado seguro).
 *   semanas = [10 + 1.5 + 7 = 18.5, 20, 30, 40].
 *   H = 7: mié (4·10 + 3·20 + 2·30 + 1·40)/10 = 20 · jue 4·1.5/10 = 0.6 · mar 4·7/10 = 2.8 → 23.4.
 *   Foto: 10. Mínimo: 5 → sugerido 23.4 − 10 + 5 = 18.4.
 *   H = 1 (sólo hoy, mié): 20 → 15. H = 10 (+ mié, jue, vie): 23.4 + 20 + 0.6 = 44 → 39.
 * - I2 Tortilla (PZ): inicial 08-01 +100, sin salidas → proyección 0; foto 100; sin mínimo →
 *   sugerido 0 y aviso sin_minimo.
 * - I3 Vaso nuevo: compra 09-06 +20 → 10 días de historial → sin_historial (nulos); foto 20;
 *   mínimo 5.
 * - I4: sólo tiene mínimo (3): 0 días, sin_historial; no viene en la foto → existencia 0 y aviso
 *   fuera_de_foto.
 * - I5: primer movimiento 08-19 10:00 local (inicial +10): 28 días JUSTOS → calculada, proyección
 *   0; no viene en la foto → existencia 0, fuera_de_foto, sin_minimo; sugerido 0.
 * - I6: primer movimiento 08-20 (inicial +10): 27 días → sin_historial.
 * A1 · ALM2: I1 inicial 08-01 +50, consumo 09-09 −4 → H = 7: 4·4/10 = 1.6. Foto de hace 2 h
 *   (atrasada: > 90 min) con I1 1 → sugerido 0.6, avisos sin_minimo y foto_atrasada.
 * A1 · ALM3: I1 inicial 08-01 +5 y SIN foto → proyección 0, existencia y sugerido nulos, sin_foto.
 *
 * A2 · ALM1 (Tijuana): I1 inicial 08-01 +30; consumo 2026-09-15T23:30-07:00 (= 09-16 06:30Z: en
 *   CDMX ya sería hoy, en Tijuana es martes 09-15) −8 → 4·8/10 = 3.2; consumo 2026-09-16 00:30
 *   local (hoy) −50 no cuenta. Foto 2 → sugerido 1.2 (sin mínimo).
 * A3: sin pólizas → calculada=false, motivo sin_polizas, ninguna fila.
 * B1 (empresa B): I1 inicial y consumos: nunca aparece para la empresa A.
 */

const HOY_Z = '2026-09-16T18:00:00.000Z';
const mov = (insumo: string, cantidad: string, costo = '10') => ({
  insumoOrigenSrId: insumo,
  cantidad,
  costoUnitario: costo,
});
const pol = (
  origen: string,
  tipo: string,
  almacen: string,
  fecha: string,
  partidas: Registro[],
  extra = {},
) => ({
  origenSrId: origen,
  folio: `POL-${origen}`,
  tipo,
  almacenOrigenSrId: almacen,
  fecha,
  referencia: null,
  cancelada: false,
  partidas,
  ...extra,
});
const cdmx = (dia: string, hora = '12:00') => `${dia}T${hora}:00.000-06:00`;

describe('Proyecciones y sugerido de compra (e2e, F2-127)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;
  let ahora = Date.parse(HOY_Z);

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const proyecciones = async (u: Usuario | null, query: Record<string, string> = {}) => {
    const r = request(url)
      .get('/inventario/proyecciones')
      .query({ empresaId: FX.empresaA, ...query });
    return u ? r.set('Authorization', `Bearer ${await token(u)}`) : r;
  };
  const post = async (key: string, ruta: string, body: Registro) => {
    const r = await request(url).post(ruta).set('X-Api-Key', key).send(body);
    expect(r.status).toBe(200);
    return r.body as Registro;
  };
  let n = 0;
  const catalogo = async (key: string, cat: string, registros: Registro[]) => {
    n++;
    const base = { catalogo: cat, sincronizacionId: sinc(n), capturadoAt: HOY_Z };
    expect(
      ((await post(key, '/ingesta/catalogos', { ...base, registros })) as { rechazados: [] })
        .rechazados,
    ).toEqual([]);
    await post(key, '/ingesta/catalogos/cierre', { ...base, total: registros.length, rechazados: 0 });
  };
  const polizas = async (key: string, lista: Registro[]) => {
    const r = await post(key, '/ingesta/movimientos', { leidoAt: HOY_Z, polizas: lista });
    expect(r.rechazadas).toEqual([]);
  };
  const foto = async (key: string, almacen: string, registros: Array<[string, string]>) => {
    const r = await post(key, '/ingesta/existencias', {
      almacenOrigenSrId: almacen,
      capturadoAt: new Date(ahora).toISOString(),
      registros: registros.map(([i, c]) => ({
        insumoOrigenSrId: i,
        cantidad: c,
        costoPromedio: '10',
      })),
    });
    expect(r.rechazados).toEqual([]);
  };
  const minimo = (sucursalId: string, almacen: string, insumo: string, valor: string) =>
    prisma.limiteExistencia.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId,
        almacenOrigenSrId: almacen,
        insumoOrigenSrId: insumo,
        minimo: valor,
        actualizadoPor: USUARIOS.adminEmpresaA.id,
        updatedAt: new Date(HOY_Z),
      },
    });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    await prisma.sucursal.create({
      data: { id: A3, empresaId: FX.empresaA, nombre: 'A3', zonaHoraria: 'America/Mexico_City' },
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue({ ahora: () => ahora })
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    await catalogo(KEYS.a1, 'unidades', [
      { origenSrId: 'KG', nombre: 'Kilogramo' },
      { origenSrId: 'PZ', nombre: 'Pieza' },
    ]);
    await catalogo(KEYS.a1, 'insumos', [
      { origenSrId: 'I1', clave: 'C-01', nombre: 'Carne al pastor', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', nombre: 'Tortilla', unidadOrigenSrId: 'PZ' },
      { origenSrId: 'I3', nombre: 'Vaso nuevo', unidadOrigenSrId: 'PZ' },
    ]);
    await catalogo(KEYS.a1, 'almacenes', [
      { origenSrId: 'ALM1', nombre: 'General' },
      { origenSrId: 'ALM2', nombre: 'Barra' },
    ]);

    const ini = (o: string, alm: string, dia: string, partidas: Registro[]) =>
      pol(o, 'inicial', alm, cdmx(dia, '09:00'), partidas);
    await polizas(KEYS.a1, [
      ini('A-INI1', 'ALM1', '2026-08-01', [mov('I1', '200'), mov('I2', '100')]),
      pol('A-K1', 'consumo', 'ALM1', cdmx('2026-09-09', '22:00'), [mov('I1', '-10')]),
      pol('A-K2', 'consumo', 'ALM1', cdmx('2026-09-02'), [mov('I1', '-20')]),
      pol('A-K3', 'consumo', 'ALM1', cdmx('2026-08-26'), [mov('I1', '-30')]),
      pol('A-K4', 'consumo', 'ALM1', '2026-08-19T06:30:00.000Z', [mov('I1', '-40')]),
      pol('A-M1', 'merma', 'ALM1', cdmx('2026-09-10'), [mov('I1', '-1')]),
      pol('A-T1', 'traspaso_salida', 'ALM1', cdmx('2026-09-10', '15:00'), [mov('I1', '-0.5')]),
      pol('A-K5', 'consumo', 'ALM1', '2026-09-16T05:30:00.000Z', [mov('I1', '-7')]),
      // No cuentan:
      pol('A-J1', 'ajuste', 'ALM1', cdmx('2026-09-14'), [mov('I1', '-100')]),
      pol('A-X1', 'consumo', 'ALM1', cdmx('2026-09-08'), [mov('I1', '-100')], { cancelada: true }),
      pol('A-C1', 'compra', 'ALM1', cdmx('2026-09-03'), [mov('I1', '50')]),
      pol('A-K6', 'consumo', 'ALM1', '2026-08-19T05:30:00.000Z', [mov('I1', '-999')]),
      pol('A-K7', 'consumo', 'ALM1', cdmx('2026-09-16', '08:00'), [mov('I1', '-999')]),
      pol('A-E1', 'traspaso_entrada', 'ALM1', cdmx('2026-09-11'), [mov('I1', '3')]),
      pol('A-K9', 'consumo', 'ALM1', cdmx('2026-09-02', '18:00'), [mov('I1', '5')]),
      // Historial corto y límite:
      pol('A-C2', 'compra', 'ALM1', cdmx('2026-09-06'), [mov('I3', '20')]),
      pol('A-INI5', 'inicial', 'ALM1', cdmx('2026-08-19', '10:00'), [mov('I5', '10')]),
      pol('A-INI6', 'inicial', 'ALM1', cdmx('2026-08-20', '10:00'), [mov('I6', '10')]),
      // Otros almacenes:
      ini('A-INI2', 'ALM2', '2026-08-01', [mov('I1', '50')]),
      pol('A-K8', 'consumo', 'ALM2', cdmx('2026-09-09'), [mov('I1', '-4')]),
      ini('A-INI3', 'ALM3', '2026-08-01', [mov('I1', '5')]),
    ]);
    // ALM2: foto recibida hace 2 h (atrasada). ALM1: foto de ahora. ALM3: sin foto.
    ahora = Date.parse(HOY_Z) - 2 * 60 * 60 * 1000;
    await foto(KEYS.a1, 'ALM2', [['I1', '1']]);
    ahora = Date.parse(HOY_Z);
    await foto(KEYS.a1, 'ALM1', [
      ['I1', '10'],
      ['I2', '100'],
      ['I3', '20'],
      ['I6', '10'],
    ]);
    await minimo(FX.sucursalA1, 'ALM1', 'I1', '5');
    await minimo(FX.sucursalA1, 'ALM1', 'I3', '5');
    await minimo(FX.sucursalA1, 'ALM1', 'I4', '3');

    await polizas(KEYS.a2, [
      pol('B-INI', 'inicial', 'ALM1', '2026-08-01T09:00:00.000-07:00', [mov('I1', '30')]),
      pol('B-K1', 'consumo', 'ALM1', '2026-09-15T23:30:00.000-07:00', [mov('I1', '-8')]),
      pol('B-K2', 'consumo', 'ALM1', '2026-09-16T00:30:00.000-07:00', [mov('I1', '-50')]),
    ]);
    await foto(KEYS.a2, 'ALM1', [['I1', '2']]);

    await polizas(KEYS.b1, [
      pol('Z-INI', 'inicial', 'ALM1', cdmx('2026-08-01'), [mov('I1', '500')]),
      pol('Z-K1', 'consumo', 'ALM1', cdmx('2026-09-09'), [mov('I1', '-300')]),
    ]);
    await foto(KEYS.b1, 'ALM1', [['I1', '200']]);
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const fila = (body: { filas: Registro[] }, sucursalId: string, almacen: string, insumo: string) =>
    body.filas.find(
      (f) =>
        f.sucursalId === sucursalId && f.almacenOrigenSrId === almacen && f.insumoOrigenSrId === insumo,
    );

  describe('GET /inventario/proyecciones', () => {
    it('I1 de A1·ALM1 cuadra con el cálculo a mano (H = 7 por defecto)', async () => {
      const r = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(r.status).toBe(200);
      expect(r.body.horizonte).toBe(7);
      expect(r.body.pesos).toEqual([4, 3, 2, 1]);
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I1')).toEqual({
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        almacenOrigenSrId: 'ALM1',
        almacen: 'General',
        insumoOrigenSrId: 'I1',
        insumo: 'Carne al pastor',
        clave: 'C-01',
        unidad: 'Kilogramo',
        estado: 'calculada',
        diasHistorial: 46,
        semanas: ['18.500', '20.000', '30.000', '40.000'],
        proyeccion: '23.400',
        existencia: '10.000',
        minimo: '5.000',
        sugerido: '18.400',
        avisos: [],
      });
    });

    it('el horizonte cambia la proyección: H = 1 → 20 / 15, H = 10 → 44 / 39', async () => {
      const uno = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA1, horizonte: '1' });
      expect(uno.body.horizonte).toBe(1);
      expect(fila(uno.body, FX.sucursalA1, 'ALM1', 'I1')).toMatchObject({
        proyeccion: '20.000',
        sugerido: '15.000',
      });
      const diez = await proyecciones(USUARIOS.visorA, {
        sucursalId: FX.sucursalA1,
        horizonte: '10',
      });
      expect(fila(diez.body, FX.sucursalA1, 'ALM1', 'I1')).toMatchObject({
        proyeccion: '44.000',
        sugerido: '39.000',
      });
      expect(diez.body.sucursales[0]).toMatchObject({
        hoy: '2026-09-16',
        ventanaDesde: '2026-08-19',
        ventanaHasta: '2026-09-15',
        horizonteDesde: '2026-09-16',
        horizonteHasta: '2026-09-25',
      });
    });

    it('sin salidas: proyección 0 y sugerido 0 (es un dato), con aviso de sin mínimo', async () => {
      const r = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I2')).toMatchObject({
        estado: 'calculada',
        semanas: ['0.000', '0.000', '0.000', '0.000'],
        proyeccion: '0.000',
        existencia: '100.000',
        minimo: null,
        sugerido: '0.000',
        avisos: ['sin_minimo'],
      });
    });

    it('sin historial: "sin datos" (nulos), nunca un 0 a ciegas; 28 días justos sí proyecta', async () => {
      const r = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I3')).toMatchObject({
        insumo: 'Vaso nuevo',
        estado: 'sin_historial',
        diasHistorial: 10,
        semanas: null,
        proyeccion: null,
        existencia: '20.000',
        minimo: '5.000',
        sugerido: null,
        avisos: [],
      });
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I4')).toMatchObject({
        insumo: null,
        estado: 'sin_historial',
        diasHistorial: 0,
        proyeccion: null,
        existencia: '0.000',
        minimo: '3.000',
        sugerido: null,
        avisos: ['fuera_de_foto'],
      });
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I5')).toMatchObject({
        estado: 'calculada',
        diasHistorial: 28,
        proyeccion: '0.000',
        existencia: '0.000',
        sugerido: '0.000',
        avisos: ['fuera_de_foto', 'sin_minimo'],
      });
      expect(fila(r.body, FX.sucursalA1, 'ALM1', 'I6')).toMatchObject({
        estado: 'sin_historial',
        diasHistorial: 27,
        sugerido: null,
      });
    });

    it('foto atrasada se avisa; almacén sin foto = existencia y sugerido nulos', async () => {
      const r = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(fila(r.body, FX.sucursalA1, 'ALM2', 'I1')).toMatchObject({
        almacen: 'Barra',
        proyeccion: '1.600',
        existencia: '1.000',
        sugerido: '0.600',
        avisos: ['foto_atrasada', 'sin_minimo'],
      });
      expect(fila(r.body, FX.sucursalA1, 'ALM3', 'I1')).toMatchObject({
        almacen: null,
        estado: 'calculada',
        proyeccion: '0.000',
        existencia: null,
        sugerido: null,
        avisos: ['sin_foto', 'sin_minimo'],
      });
    });

    it('el día se corta en la zona de CADA sucursal (Tijuana)', async () => {
      const r = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalA2 });
      expect(r.status).toBe(200);
      expect(fila(r.body, FX.sucursalA2, 'ALM1', 'I1')).toMatchObject({
        semanas: ['8.000', '0.000', '0.000', '0.000'],
        proyeccion: '3.200',
        existencia: '2.000',
        sugerido: '1.200',
      });
    });

    it('sin sucursal: sólo la empresa del usuario; A3 sin pólizas no se calcula', async () => {
      const r = await proyecciones(USUARIOS.visorA);
      expect(r.status).toBe(200);
      expect(r.body.sucursales.map((s: Registro) => [s.sucursal, s.calculada, s.motivo])).toEqual([
        ['A1', true, null],
        ['A2', true, null],
        ['A3', false, 'sin_polizas'],
      ]);
      const suc = new Set(r.body.filas.map((f: Registro) => f.sucursalId));
      expect([...suc].sort()).toEqual([FX.sucursalA1, FX.sucursalA2].sort());
      expect(r.body.filas).toHaveLength(9); // A1: 6 en ALM1 + ALM2 + ALM3; A2: 1
      expect(r.body.kpis).toEqual({ filas: 9, conSugerido: 3, sinHistorial: 3 });
      // B1 tiene 300 de consumo: si se colara, habría una fila con 120 de proyección.
      expect(r.body.filas.some((f: Registro) => f.proyeccion === '120.000')).toBe(false);
    });

    it('el admin global ve lo mismo de la empresa A; el visor B ve sólo B1', async () => {
      const g = await proyecciones(USUARIOS.adminGlobal);
      expect(g.body.kpis).toEqual({ filas: 9, conSugerido: 3, sinHistorial: 3 });
      const b = await proyecciones(USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(b.status).toBe(200);
      expect(b.body.filas.map((f: Registro) => [f.sucursalId, f.proyeccion])).toEqual([
        [FX.sucursalB1, '120.000'],
      ]);
    });

    it('filtra por almacén', async () => {
      const r = await proyecciones(USUARIOS.visorA, {
        sucursalId: FX.sucursalA1,
        almacenOrigenSrId: 'ALM2',
      });
      expect(r.body.filas.map((f: Registro) => f.insumoOrigenSrId)).toEqual(['I1']);
    });

    it('404 fuera de alcance, idéntico a "no existe" (nunca 403)', async () => {
      const otra = await proyecciones(USUARIOS.visorA, { empresaId: FX.empresaB });
      const cruzada = await proyecciones(USUARIOS.visorA, { sucursalId: FX.sucursalB1 });
      const ajena = await proyecciones(USUARIOS.visorB);
      const inexistente = await proyecciones(USUARIOS.adminGlobal, { empresaId: FX.inexistente });
      for (const r of [otra, cruzada, ajena, inexistente]) expect(r.status).toBe(404);
      expect(otra.body).toEqual(inexistente.body);
    });

    it('400: horizonte fuera de 1..28 o no entero; almacén sin sucursal', async () => {
      for (const horizonte of ['0', '29', 'abc', '7.5']) {
        const r = await proyecciones(USUARIOS.visorA, { horizonte });
        expect(r.status).toBe(400);
      }
      const r = await proyecciones(USUARIOS.visorA, { almacenOrigenSrId: 'ALM1' });
      expect(r.status).toBe(400);
    });

    it('401 sin token', async () => {
      expect((await proyecciones(null)).status).toBe(401);
    });
  });
});
