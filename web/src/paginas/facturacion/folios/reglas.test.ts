import { describe, expect, it } from 'vitest';

import type { EstadoFolios } from '../../../api/tipos';
import {
  csvReporte,
  erroresPaquete,
  explicacionSaldo,
  hoyFolios,
  moverMes,
  nombreMes,
  porcentajeDisponible,
  rangoPorOmision,
  ultimoDiaUtil,
} from './reglas';

const BASE: EstadoFolios = {
  control: true,
  umbralPct: 20,
  estado: 'ok',
  disponible: 19,
  vigenteTotal: 100,
  enEmision: 0,
  sobregiro: 0,
  avisoUmbralAt: null,
  paquetes: [],
  consumoPorEmpresa: [],
};

describe('reglas de Folios (F2-110)', () => {
  it('fechas en CDMX: hoy, el último día útil (vence exclusivo) y el rango por omisión', () => {
    // 23 de septiembre 01:00 UTC = 22 de septiembre 19:00 en CDMX.
    expect(hoyFolios(new Date('2026-09-23T01:00:00Z'))).toBe('2026-09-22');
    expect(ultimoDiaUtil('2027-09-01T06:00:00.000Z')).toBe('31/08/2027');
    expect(rangoPorOmision(new Date('2026-01-01T05:00:00Z'))).toEqual({
      desde: '2025-01',
      hasta: '2025-12',
    });
    expect(moverMes('2026-01', -1)).toBe('2025-12');
    expect(nombreMes('2026-09')).toBe('septiembre de 2026');
  });

  it('porcentaje disponible: entero hacia abajo; sin vigentes, null (no un cero)', () => {
    expect(porcentajeDisponible(BASE)).toBe(19);
    expect(porcentajeDisponible({ ...BASE, disponible: 1, vigenteTotal: 3 })).toBe(33);
    expect(porcentajeDisponible({ ...BASE, disponible: 0, vigenteTotal: 0 })).toBeNull();
  });

  it('explica cada estado con qué hacer', () => {
    expect(explicacionSaldo({ ...BASE, estado: 'bajo' })).toMatch(/menos del 20 %/);
    expect(explicacionSaldo({ ...BASE, estado: 'agotado' })).toMatch(/registres un paquete/);
    expect(explicacionSaldo({ ...BASE, control: false, estado: 'sin_control' })).toMatch(
      /control está apagado/,
    );
  });

  it('valida el alta: cantidad 1..1,000,000 y fecha no futura', () => {
    const hoy = '2026-09-23';
    expect(erroresPaquete({ cantidad: '1000', fechaCompra: '2026-09-23' }, hoy)).toEqual({});
    expect(erroresPaquete({ cantidad: '0', fechaCompra: '2026-09-23' }, hoy).cantidad).toBeTruthy();
    expect(
      erroresPaquete({ cantidad: '1.5', fechaCompra: '2026-09-23' }, hoy).cantidad,
    ).toBeTruthy();
    expect(
      erroresPaquete({ cantidad: '1000001', fechaCompra: '2026-09-23' }, hoy).cantidad,
    ).toBeTruthy();
    expect(erroresPaquete({ cantidad: '5', fechaCompra: '2026-09-24' }, hoy).fechaCompra).toBe(
      'La fecha de compra no puede ser futura.',
    );
    expect(erroresPaquete({ cantidad: '5', fechaCompra: '' }, hoy).fechaCompra).toBeTruthy();
  });

  it('CSV del reporte: filas por empresa y mes, totales, y un nombre con fórmula neutralizado', () => {
    const csv = csvReporte({
      desde: '2026-08',
      hasta: '2026-08',
      filas: [
        {
          empresaId: 'e',
          empresa: '=HIPERVINCULO("x")',
          mes: '2026-08',
          vigentes: 9,
          cancelados: 1,
          total: 10,
          ticket: 7,
          manual: 1,
          global: 1,
          sustitutos: 1,
        },
      ],
      totales: [{ mes: '2026-08', vigentes: 9, cancelados: 1, total: 10 }],
    });
    expect(csv.startsWith('﻿')).toBe(true);
    const lineas = csv.slice(1).trim().split('\r\n');
    expect(lineas[0]).toBe(
      'Mes,Empresa,Vigentes,Cancelados,Total,Portal (ticket),Sin ticket,Global,Sustitutos',
    );
    expect(lineas[1]).toBe('2026-08,"\'=HIPERVINCULO(""x"")",9,1,10,7,1,1,1');
    expect(lineas[2]).toBe('2026-08,TOTAL,9,1,10,,,,');
  });
});
