import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MesasSucursal, SnapshotMesas } from '../../api/tipos';
import { TooltipHora } from './graficas';
import { datosPorHora } from './puntosHora';
import { edadLegible, ventaEnVivo } from './ventaEnVivo';

function snapshot(mesas: Record<string, unknown>[], edadRecepcionSegundos = 30): SnapshotMesas {
  return {
    capturadoAt: '2026-09-20T19:00:00.000Z',
    recibidoAt: '2026-09-20T19:00:01.000Z',
    edadSegundos: 5,
    edadRecepcionSegundos,
    mesas,
  };
}

function fila(nombre: string, snap: SnapshotMesas | null): MesasSucursal {
  return { sucursalId: nombre, nombre, zonaHoraria: 'America/Mexico_City', snapshot: snap };
}

describe('ventaEnVivo', () => {
  it('suma exacto los totales de todas las sucursales', () => {
    const vivo = ventaEnVivo([
      fila('Centro', snapshot([{ total: '0.10' }, { total: '100.00' }])),
      fila('Norte', snapshot([{ total: '0.20' }, { total: 50 }], 300)),
    ]);
    expect(vivo.total).toBe(15030n);
    expect(vivo.mesas).toBe(4);
    expect(vivo.reportando).toBe(2);
    expect(vivo.sinReporte).toEqual([]);
    // La edad es la del snapshot MÁS VIEJO, y es la de recepción (reloj del servidor).
    expect(vivo.edadMaximaSegundos).toBe(300);
  });

  it('si una sola mesa no trae un total legible, no hay suma (nada de parciales)', () => {
    for (const mala of [{}, { total: 'mucho' }, { total: null }, { total: Number.NaN }]) {
      const vivo = ventaEnVivo([fila('Centro', snapshot([{ total: '10.00' }, mala]))]);
      expect(vivo.total, JSON.stringify(mala)).toBeNull();
      expect(vivo.mesas).toBe(2);
    }
  });

  it('las sucursales sin snapshot se nombran y no cuentan', () => {
    const vivo = ventaEnVivo([fila('Centro', snapshot([])), fila('Tijuana', null)]);
    expect(vivo.total).toBe(0n);
    expect(vivo.reportando).toBe(1);
    expect(vivo.sinReporte).toEqual(['Tijuana']);
  });

  it('sin ningún snapshot, nadie reporta', () => {
    const vivo = ventaEnVivo([fila('Centro', null)]);
    expect(vivo.reportando).toBe(0);
    expect(vivo.edadMaximaSegundos).toBeNull();
  });
});

describe('edadLegible', () => {
  it('redondea hacia abajo a la unidad que toca', () => {
    expect(edadLegible(10)).toBe('hace menos de 1 min');
    expect(edadLegible(119)).toBe('hace 1 min');
    expect(edadLegible(3 * 3600 + 5)).toBe('hace 3 h');
    expect(edadLegible(3 * 86400)).toBe('hace 3 días');
  });
});

describe('datosPorHora', () => {
  it('24 horas en orden, con el texto exacto y cero donde no hubo', () => {
    const puntos = datosPorHora([
      { hora: 13, venta: '1234.50', cuentas: 3 },
      { hora: 0, venta: '0.10', cuentas: 1 },
    ]);
    expect(puntos).toHaveLength(24);
    expect(puntos.map((p) => p.hora)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(puntos[13]).toEqual({
      hora: 13,
      etiqueta: '13:00',
      valor: 1234.5,
      texto: '$1,234.50',
      cuentas: 3,
    });
    expect(puntos[0].texto).toBe('$0.10');
    expect(puntos[5]).toMatchObject({ etiqueta: '05:00', valor: 0, texto: '$0.00', cuentas: 0 });
  });
});

describe('TooltipHora', () => {
  it('muestra el importe exacto del punto, no el número de la gráfica', () => {
    const [punto] = datosPorHora([{ hora: 0, venta: '1234.50', cuentas: 1 }]);
    render(<TooltipHora active payload={[{ payload: punto }]} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
    expect(screen.getByText('1 cuenta')).toBeInTheDocument();
  });

  it('inactivo no pinta nada', () => {
    const { container } = render(<TooltipHora active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
