import { MotivoCierreAlerta, SeveridadAlerta, TipoAlerta } from '@prisma/client';

import type { AlertaAbierta } from '../scope/escritura-alertas';
import {
  caidaDeVenta,
  estaBajoMinimo,
  evaluar,
  llaveArticulo,
  type EstadoBajoCandado,
  type Observacion,
  type SucursalObservada,
} from './evaluador';
import { Prisma } from '@prisma/client';

import {
  cuentasDelSnapshot,
  diaLocal,
  existenciasObservadas,
  minutosAbierta,
  restarDias,
} from './observar';
import { reglasEfectivas } from './reglas';

const S1 = 'suc-1';
const S2 = 'suc-2';

function sucursal(p: Partial<SucursalObservada> = {}): SucursalObservada {
  return {
    sucursalId: S1,
    edadReporteS: 20,
    snapshotVivo: true,
    cuentas: [],
    venta: null,
    existencias: null,
    ...p,
  };
}

function estado(p: Partial<EstadoBajoCandado> = {}): EstadoBajoCandado {
  return {
    empresaActiva: true,
    sucursalesActivas: new Set([S1, S2]),
    reglas: reglasEfectivas([]),
    abiertas: [],
    ...p,
  };
}

function obs(...sucursales: SucursalObservada[]): Observacion {
  return { empresaId: 'emp', sucursales };
}

const abierta = (id: string, tipo: TipoAlerta, llave: string, sucursalId = S1): AlertaAbierta => ({
  id,
  sucursalId,
  tipo,
  llave,
});

describe('evaluador de alertas (puro)', () => {
  describe('sucursal sin reporte', () => {
    it('> umbral abre crítica; en el umbral exacto no', () => {
      expect(evaluar(obs(sucursal({ edadReporteS: 600 })), estado()).abrir).toEqual([]);
      const c = evaluar(obs(sucursal({ edadReporteS: 601 })), estado());
      expect(c.abrir).toEqual([
        {
          sucursalId: S1,
          tipo: TipoAlerta.sucursal_sin_reporte,
          severidad: SeveridadAlerta.critica,
          llave: '',
          umbral: 10,
          detalle: { nunca: false, edadSegundos: 601 },
        },
      ]);
    });

    it('nunca reportó: abre con `nunca: true`', () => {
      const c = evaluar(obs(sucursal({ edadReporteS: null, snapshotVivo: false })), estado());
      expect(c.abrir.map((a) => a.detalle)).toEqual([{ nunca: true }]);
    });

    it('ya abierta y sigue: no abre otra; vuelve el reporte: cierra por condición', () => {
      const ab = [abierta('a1', TipoAlerta.sucursal_sin_reporte, '')];
      expect(evaluar(obs(sucursal({ edadReporteS: 9999 })), estado({ abiertas: ab }))).toEqual({
        abrir: [],
        cerrar: [],
      });
      expect(evaluar(obs(sucursal({ edadReporteS: 5 })), estado({ abiertas: ab })).cerrar).toEqual([
        { id: 'a1', motivo: MotivoCierreAlerta.condicion },
      ]);
    });
  });

  describe('mesa abierta y cuenta sin imprimir', () => {
    const cuentas = [
      { folio: 'F1', mesa: '1', minutos: 60, impreso: true },
      { folio: 'F2', mesa: '2', minutos: 61, impreso: false },
      { folio: 'F3', mesa: null, minutos: 31, impreso: false },
      { folio: 'F4', mesa: '4', minutos: 90, impreso: null },
    ];

    it('mesa: > 60 (61 sí, 60 no); cuenta: impreso false y > 30', () => {
      const c = evaluar(obs(sucursal({ cuentas })), estado());
      const por = (t: TipoAlerta) => c.abrir.filter((a) => a.tipo === t).map((a) => a.llave);
      expect(por(TipoAlerta.mesa_abierta)).toEqual(['F2', 'F4']);
      expect(por(TipoAlerta.cuenta_sin_imprimir)).toEqual(['F2', 'F3']);
      expect(c.abrir.find((a) => a.llave === 'F3')!.detalle).toEqual({
        folio: 'F3',
        mesa: null,
        minutos: 31,
      });
    });

    it('snapshot viejo: ni abre ni cierra (las abiertas quedan intactas)', () => {
      const ab = [abierta('m1', TipoAlerta.mesa_abierta, 'F9')];
      const c = evaluar(
        obs(sucursal({ snapshotVivo: false, cuentas: [] })),
        estado({ abiertas: ab }),
      );
      expect(c).toEqual({ abrir: [], cerrar: [] });
    });

    it('la cuenta ya no está en el snapshot vivo: se cierra la MISMA fila', () => {
      const ab = [abierta('m1', TipoAlerta.mesa_abierta, 'F2')];
      const c = evaluar(obs(sucursal({ cuentas: [] })), estado({ abiertas: ab }));
      expect(c).toEqual({
        abrir: [],
        cerrar: [{ id: 'm1', motivo: MotivoCierreAlerta.condicion }],
      });
    });

    it('umbral nuevo: la que ya no lo alcanza cierra por condición', () => {
      const ab = [abierta('m1', TipoAlerta.mesa_abierta, 'F2')];
      const reglas = reglasEfectivas([
        { tipo: TipoAlerta.mesa_abierta, activa: true, umbral: 200 },
      ]);
      const c = evaluar(obs(sucursal({ cuentas })), estado({ abiertas: ab, reglas }));
      expect(c.cerrar).toEqual([{ id: 'm1', motivo: MotivoCierreAlerta.condicion }]);
      expect(c.abrir.filter((a) => a.tipo === TipoAlerta.mesa_abierta)).toEqual([]);
    });
  });

  describe('reglas, sucursales y empresa', () => {
    it('regla apagada: cierra las de su tipo y no abre', () => {
      const ab = [abierta('m1', TipoAlerta.mesa_abierta, 'F2')];
      const reglas = reglasEfectivas([
        { tipo: TipoAlerta.mesa_abierta, activa: false, umbral: 60 },
      ]);
      const c = evaluar(
        obs(sucursal({ cuentas: [{ folio: 'F2', mesa: '2', minutos: 99, impreso: true }] })),
        estado({ abiertas: ab, reglas }),
      );
      expect(c).toEqual({
        abrir: [],
        cerrar: [{ id: 'm1', motivo: MotivoCierreAlerta.regla_apagada }],
      });
    });

    it('sucursal inactiva (leída bajo candado): cierra lo suyo y no la evalúa', () => {
      const ab = [abierta('x', TipoAlerta.sucursal_sin_reporte, '', S2)];
      const c = evaluar(
        obs(sucursal({ sucursalId: S2, edadReporteS: null })),
        estado({ abiertas: ab, sucursalesActivas: new Set([S1]) }),
      );
      expect(c).toEqual({
        abrir: [],
        cerrar: [{ id: 'x', motivo: MotivoCierreAlerta.sucursal_inactiva }],
      });
    });

    it('empresa inactiva: cierra todo con empresa_inactiva', () => {
      const ab = [
        abierta('a', TipoAlerta.mesa_abierta, 'F1'),
        abierta('b', TipoAlerta.caida_venta, '2026-09-22'),
      ];
      const c = evaluar(
        obs(sucursal({ edadReporteS: null })),
        estado({ abiertas: ab, empresaActiva: false }),
      );
      expect(c).toEqual({
        abrir: [],
        cerrar: [
          { id: 'a', motivo: MotivoCierreAlerta.empresa_inactiva },
          { id: 'b', motivo: MotivoCierreAlerta.empresa_inactiva },
        ],
      });
    });
  });

  describe('caída de venta', () => {
    const venta = { dia: '2026-09-22', hoy: '690.00', base: '1000.00', cuentasBase: 5 };

    it('caidaDeVenta en Decimal: 31 % sí, 30 % exacto no', () => {
      expect(caidaDeVenta('690.00', '1000.00', 30)).toBe('31.00');
      expect(caidaDeVenta('700.00', '1000.00', 30)).toBeNull();
      expect(caidaDeVenta('0.00', '0.00', 30)).toBeNull();
      expect(caidaDeVenta('0.10', '0.30', 30)).toBe('66.67');
    });

    it('abre con importes y % como TEXTO', () => {
      const c = evaluar(obs(sucursal({ venta })), estado());
      const a = c.abrir.find((x) => x.tipo === TipoAlerta.caida_venta)!;
      expect(a.llave).toBe('2026-09-22');
      expect(a.detalle).toEqual({
        dia: '2026-09-22',
        ventaHoy: '690.00',
        ventaBase: '1000.00',
        cuentasBase: 5,
        caidaPct: '31.00',
      });
      for (const k of ['ventaHoy', 'ventaBase', 'caidaPct'] as const) {
        expect(typeof (a.detalle as Record<string, unknown>)[k]).toBe('string');
      }
    });

    it('base con menos de 5 cuentas o sucursal sin reporte reciente: no se juzga', () => {
      expect(
        evaluar(obs(sucursal({ venta: { ...venta, cuentasBase: 4 } })), estado()).abrir,
      ).toEqual([]);
      const ab = [abierta('c', TipoAlerta.caida_venta, '2026-09-22')];
      expect(
        evaluar(obs(sucursal({ edadReporteS: 601, venta })), estado({ abiertas: ab })).cerrar,
      ).toEqual([]);
    });

    it('la de otro día se cierra aunque hoy no se pueda juzgar', () => {
      const ab = [abierta('c', TipoAlerta.caida_venta, '2026-09-21')];
      const c = evaluar(
        obs(sucursal({ venta: { ...venta, cuentasBase: 1 } })),
        estado({ abiertas: ab }),
      );
      expect(c.cerrar).toEqual([{ id: 'c', motivo: MotivoCierreAlerta.condicion }]);
    });
  });
});

describe('bajo mínimo (F2-121)', () => {
  const L = llaveArticulo('ALM-1', 'I01');
  const art = (cantidad: string, minimo = '10.000') => ({
    llave: L,
    almacen: 'ALM-1',
    insumo: 'I01',
    nombre: 'Tomate',
    cantidad,
    minimo,
  });
  const conExistencias = (articulos: ReturnType<typeof art>[], sinLectura: string[] = []) =>
    sucursal({ existencias: { articulos, sinLectura } });
  const soloBajo = (c: ReturnType<typeof evaluar>) =>
    c.abrir.filter((a) => a.tipo === TipoAlerta.bajo_minimo);

  it('estaBajoMinimo en Decimal: estrictamente menor; en el mínimo exacto no', () => {
    expect(estaBajoMinimo('9.999', '10.000', 100)).toBe(true);
    expect(estaBajoMinimo('10.000', '10.000', 100)).toBe(false);
    expect(estaBajoMinimo('-1.000', '10.000', 100)).toBe(true);
    expect(estaBajoMinimo('4.999', '10.000', 50)).toBe(true);
    expect(estaBajoMinimo('5.000', '10.000', 50)).toBe(false);
  });

  it('abre advertencia con llave [almacén, insumo] y cantidades como TEXTO; en el mínimo no', () => {
    expect(soloBajo(evaluar(obs(conExistencias([art('10.000')])), estado()))).toEqual([]);
    expect(soloBajo(evaluar(obs(conExistencias([art('4.000')])), estado()))).toEqual([
      {
        sucursalId: S1,
        tipo: TipoAlerta.bajo_minimo,
        severidad: SeveridadAlerta.advertencia,
        llave: '["ALM-1","I01"]',
        umbral: 100,
        detalle: {
          almacen: 'ALM-1',
          insumo: 'I01',
          nombre: 'Tomate',
          cantidad: '4.000',
          minimo: '10.000',
        },
      },
    ]);
  });

  it('sin existencias (nunca mandó): ni abre ni cierra', () => {
    const c = evaluar(
      obs(sucursal()),
      estado({ abiertas: [abierta('a1', TipoAlerta.bajo_minimo, L)] }),
    );
    expect(c.cerrar).toEqual([]);
    expect(soloBajo(c)).toEqual([]);
  });

  it('el artículo sube sobre su mínimo (o se borra el límite): se cierra por condición', () => {
    const abiertas = [abierta('a1', TipoAlerta.bajo_minimo, L)];
    expect(evaluar(obs(conExistencias([art('12.000')])), estado({ abiertas })).cerrar).toEqual([
      { id: 'a1', motivo: MotivoCierreAlerta.condicion },
    ]);
    // Límite borrado: el artículo ya no se observa y tampoco está "sin lectura".
    expect(evaluar(obs(conExistencias([])), estado({ abiertas })).cerrar).toEqual([
      { id: 'a1', motivo: MotivoCierreAlerta.condicion },
    ]);
  });

  it('el artículo pasa a sin lectura: la alerta abierta SIGUE abierta', () => {
    const c = evaluar(
      obs(conExistencias([], [L])),
      estado({ abiertas: [abierta('a1', TipoAlerta.bajo_minimo, L)] }),
    );
    expect(c.cerrar).toEqual([]);
    expect(soloBajo(c)).toEqual([]);
  });

  it('existenciasObservadas: sin lecturas = null; límite sin fila = sin lectura', () => {
    const D = (v: string) => new Prisma.Decimal(v);
    expect(existenciasObservadas({ lecturas: 0, limites: [], filas: [], nombres: new Map() })).toBe(
      null,
    );
    const o = existenciasObservadas({
      lecturas: 2,
      limites: [
        { almacenOrigenSrId: 'A', insumoOrigenSrId: 'I1', minimo: D('5') },
        { almacenOrigenSrId: 'A', insumoOrigenSrId: 'I2', minimo: D('5') },
      ],
      filas: [
        { almacenOrigenSrId: 'A', insumoOrigenSrId: 'I1', cantidad: D('2.5') },
        { almacenOrigenSrId: 'B', insumoOrigenSrId: 'I2', cantidad: D('9') },
      ],
      nombres: new Map([['I1', 'Uno']]),
    });
    expect(o).toEqual({
      articulos: [
        {
          llave: '["A","I1"]',
          almacen: 'A',
          insumo: 'I1',
          nombre: 'Uno',
          cantidad: '2.500',
          minimo: '5.000',
        },
      ],
      sinLectura: ['["A","I2"]'],
    });
  });
});

describe('lectura del snapshot para alertas', () => {
  const capturado = new Date('2026-09-22T18:00:00Z');

  it('minutosAbierta: misma regla que el web (captura − apertura + edad de recepción)', () => {
    expect(minutosAbierta(Date.parse('2026-09-22T17:00:30Z'), capturado.getTime(), 29)).toBe(59);
    expect(minutosAbierta(Date.parse('2026-09-22T17:00:30Z'), capturado.getTime(), 30)).toBe(60);
    expect(minutosAbierta(Date.parse('2026-09-22T18:00:01Z'), capturado.getTime(), 0)).toBeNull();
  });

  it('descarta sin folio, folio repetido, sin apertura ISO con zona y apertura futura', () => {
    const payload = {
      mesas: [
        { folio: 'A', mesa: 5, abiertoAt: '2026-09-22T16:00:00Z', impreso: false },
        { folio: 'B', abiertoAt: '2026-09-22T16:00:00Z' },
        { folio: 'B', abiertoAt: '2026-09-22T16:00:00Z' },
        { mesa: '7', abiertoAt: '2026-09-22T16:00:00Z' },
        { folio: 'C', abiertoAt: '2026-09-22T16:00:00' },
        { folio: 'D', abiertoAt: '2026-09-22T19:00:00Z' },
        'basura',
      ],
    };
    expect(cuentasDelSnapshot(payload, capturado, 0)).toEqual([
      { folio: 'A', mesa: '5', minutos: 120, impreso: false },
    ]);
    expect(cuentasDelSnapshot({ nada: 1 }, capturado, 0)).toEqual([]);
    expect(cuentasDelSnapshot(null, capturado, 0)).toEqual([]);
  });

  it('diaLocal por zona y restarDias sin horario de verano', () => {
    const t = Date.parse('2026-09-22T05:30:00Z');
    expect(diaLocal(t, 'America/Mexico_City')).toBe('2026-09-21');
    expect(diaLocal(t, 'America/Cancun')).toBe('2026-09-22');
    expect(restarDias('2026-03-10', 7)).toBe('2026-03-03');
    expect(restarDias('2026-11-05', 7)).toBe('2026-10-29');
  });
});
