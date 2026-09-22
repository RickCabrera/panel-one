import { Prisma } from '@prisma/client';

import {
  conciliarRenglones,
  estadoConciliacion,
  importeDe,
  sirveDeEntrada,
  sirveDeSalida,
  type MovimientoCandidato,
  type RenglonAConciliar,
} from './traspasos';

// La regla pura de la conciliación (F2-124). Lo esperado va escrito a mano.

const H = 3_600_000;
const T = Date.parse('2026-09-10T15:00:00Z');
const d = (v: string) => new Prisma.Decimal(v);

const renglon = (p: Partial<RenglonAConciliar> = {}): RenglonAConciliar => ({
  partidaId: 'p1',
  sucursalOrigenId: 'A1',
  almacenOrigen: 'GEN',
  sucursalDestinoId: 'A2',
  almacenDestino: 'GEN',
  insumo: 'I1',
  cantidad: d('2.5'),
  enviadoAt: T,
  recibidoAt: null,
  salida: null,
  entrada: null,
  ...p,
});

const salida = (p: Partial<MovimientoCandidato> = {}): MovimientoCandidato => ({
  polizaId: 'PS',
  renglon: 0,
  sucursalId: 'A1',
  almacen: 'GEN',
  insumo: 'I1',
  cantidad: d('-2.5'),
  fecha: T + H,
  tipo: 'traspaso_salida',
  cancelada: false,
  ...p,
});

const entrada = (p: Partial<MovimientoCandidato> = {}): MovimientoCandidato => ({
  ...salida(),
  polizaId: 'PE',
  sucursalId: 'A2',
  cantidad: d('2.5'),
  tipo: 'traspaso_entrada',
  ...p,
});

describe('conciliación de traspasos (pura, F2-124)', () => {
  describe('sirveDeSalida', () => {
    it('± 24 h exactas del envío sí; un milisegundo más, no', () => {
      expect(sirveDeSalida(renglon(), salida({ fecha: T + 24 * H }))).toBe(true);
      expect(sirveDeSalida(renglon(), salida({ fecha: T - 24 * H }))).toBe(true);
      expect(sirveDeSalida(renglon(), salida({ fecha: T + 24 * H + 1 }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ fecha: T - 24 * H - 1 }))).toBe(false);
    });

    it('exige tipo, sucursal y almacén de ORIGEN, insumo, −q exacta y póliza viva', () => {
      expect(sirveDeSalida(renglon(), salida())).toBe(true);
      expect(sirveDeSalida(renglon(), salida({ tipo: 'traspaso_entrada' }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ sucursalId: 'A2' }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ almacen: 'BAR' }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ insumo: 'I2' }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ cantidad: d('2.5') }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ cantidad: d('-2.501') }))).toBe(false);
      expect(sirveDeSalida(renglon(), salida({ cantidad: d('-2.500') }))).toBe(true);
      expect(sirveDeSalida(renglon(), salida({ cancelada: true }))).toBe(false);
    });
  });

  describe('sirveDeEntrada', () => {
    it('ventana [envío − 24 h, (recibido ?? envío) + 24 h], en el DESTINO y con +q', () => {
      expect(sirveDeEntrada(renglon(), entrada())).toBe(true);
      expect(sirveDeEntrada(renglon(), entrada({ fecha: T + 24 * H + 1 }))).toBe(false);
      // Recibido 3 días después: la entrada puede llegar hasta 24 h después de recibirlo.
      const recibido = renglon({ recibidoAt: T + 72 * H });
      expect(sirveDeEntrada(recibido, entrada({ fecha: T + 96 * H }))).toBe(true);
      expect(sirveDeEntrada(recibido, entrada({ fecha: T + 96 * H + 1 }))).toBe(false);
      expect(sirveDeEntrada(recibido, entrada({ fecha: T - 24 * H - 1 }))).toBe(false);
      expect(sirveDeEntrada(renglon(), entrada({ sucursalId: 'A1' }))).toBe(false);
      expect(sirveDeEntrada(renglon(), entrada({ cantidad: d('-2.5') }))).toBe(false);
      expect(sirveDeEntrada(renglon(), entrada({ tipo: 'traspaso_salida' }))).toBe(false);
    });
  });

  describe('conciliarRenglones', () => {
    it('asigna salida y entrada; gana la fecha más cercana', () => {
      const a = conciliarRenglones(
        [renglon()],
        [
          salida({ polizaId: 'LEJOS', fecha: T + 20 * H }),
          salida({ polizaId: 'CERCA', fecha: T + 2 * H }),
          entrada(),
        ],
      );
      expect(a.get('p1')).toEqual({
        salida: { polizaId: 'CERCA', renglon: 0 },
        entrada: { polizaId: 'PE', renglon: 0 },
      });
    });

    it('un movimiento concilia UN renglón: el primero en el orden recibido', () => {
      const a = conciliarRenglones(
        [renglon({ partidaId: 'viejo' }), renglon({ partidaId: 'nuevo' })],
        [salida()],
      );
      expect(a.get('viejo')!.salida).toEqual({ polizaId: 'PS', renglon: 0 });
      expect(a.get('nuevo')!.salida).toBeNull();
    });

    it('no toma lo ocupado por renglones que no están en la vuelta', () => {
      const a = conciliarRenglones([renglon()], [salida()], new Set(['PS#0']));
      expect(a.get('p1')!.salida).toBeNull();
    });

    it('conserva un espejo que sigue sirviendo aunque haya uno más cercano', () => {
      const r = renglon({ salida: { polizaId: 'LEJOS', renglon: 0 } });
      const a = conciliarRenglones(
        [r],
        [salida({ polizaId: 'LEJOS', fecha: T + 20 * H }), salida({ polizaId: 'CERCA' })],
      );
      expect(a.get('p1')!.salida).toEqual({ polizaId: 'LEJOS', renglon: 0 });
    });

    it('suelta un espejo que ya no sirve (cancelado o desaparecido) y busca otro', () => {
      const r = renglon({ salida: { polizaId: 'PS', renglon: 0 } });
      expect(conciliarRenglones([r], [salida({ cancelada: true })]).get('p1')!.salida).toBeNull();
      expect(conciliarRenglones([r], []).get('p1')!.salida).toBeNull();
      expect(
        conciliarRenglones([r], [salida({ cancelada: true }), salida({ polizaId: 'OTRA' })]).get(
          'p1',
        )!.salida,
      ).toEqual({ polizaId: 'OTRA', renglon: 0 });
    });

    it('determinista e idempotente: correrlo sobre su propia salida no cambia nada', () => {
      const renglones = [renglon({ partidaId: 'a' }), renglon({ partidaId: 'b' })];
      const cands = [salida(), salida({ polizaId: 'PS2' }), entrada()];
      const uno = conciliarRenglones(renglones, cands);
      const otra = conciliarRenglones(
        renglones.map((r) => ({ ...r, ...uno.get(r.partidaId)! })),
        [...cands].reverse(),
      );
      expect(otra).toEqual(uno);
    });
  });

  describe('estadoConciliacion', () => {
    const base = {
      estado: 'enviado' as const,
      conciliadoAt: null,
      enviadoAt: new Date(T),
      umbralHoras: 48,
    };
    it('pendiente hasta las 48 h exactas; en alerta pasándolas; conciliado y cancelado ganan', () => {
      expect(estadoConciliacion({ ...base, ahora: T + 48 * H })).toBe('pendiente_sr');
      expect(estadoConciliacion({ ...base, ahora: T + 48 * H + 1 })).toBe('en_alerta');
      expect(estadoConciliacion({ ...base, conciliadoAt: new Date(T), ahora: T + 99 * H })).toBe(
        'conciliado',
      );
      expect(estadoConciliacion({ ...base, estado: 'cancelado', ahora: T + 99 * H })).toBe(
        'cancelado',
      );
    });
  });

  it('importeDe: round(q × costo, 2) mitad lejos de cero; sin costo, nulo', () => {
    expect(importeDe(d('2.5'), d('30.00'))!.toFixed(2)).toBe('75.00');
    expect(importeDe(d('0.125'), d('0.20'))!.toFixed(2)).toBe('0.03'); // 0.025 → 0.03
    expect(importeDe(d('1'), null)).toBeNull();
  });
});
