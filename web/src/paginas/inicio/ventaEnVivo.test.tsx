import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MesasSucursal, SnapshotMesas } from '../../api/tipos';
import { TooltipHora } from './graficas';
import { datosPorHora } from './puntosHora';
import { armarMonitor } from '../mesas/reglas';
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

const T0 = Date.parse('2026-09-20T19:00:30.000Z');
const vivoEn = (filas: MesasSucursal[], ahora = T0) => ventaEnVivo(filas, T0, ahora);

describe('ventaEnVivo', () => {
  it('suma exacto los totales de todas las sucursales conectadas', () => {
    const vivo = vivoEn([
      fila('Centro', snapshot([{ total: '0.10' }, { total: '100.00' }])),
      fila('Norte', snapshot([{ total: '0.20' }, { total: 50 }], 75)),
    ]);
    expect(vivo.total).toBe(15030n);
    expect(vivo.mesas).toBe(4);
    expect(vivo.reportando).toBe(2);
    expect(vivo.conectadas).toBe(2);
    expect(vivo.desconectadas).toEqual([]);
    expect(vivo.sinReporte).toEqual([]);
    // La edad es la del snapshot MÁS VIEJO que se suma, de recepción (reloj del servidor).
    expect(vivo.edadMaximaSegundos).toBe(75);
  });

  it('una sucursal desconectada no se suma, se nombra, y da lo MISMO que el Monitor', () => {
    const filas = [
      fila('Centro', snapshot([{ total: '350.50' }, { total: '1200.00' }], 30)),
      fila('Norte', snapshot([{ total: '9999.00' }], 7200)),
      fila('Tijuana', null),
    ];
    const vivo = vivoEn(filas);
    expect(vivo.total).toBe(155050n);
    expect(vivo.mesas).toBe(2);
    expect(vivo.reportando).toBe(2);
    expect(vivo.conectadas).toBe(1);
    expect(vivo.desconectadas).toEqual(['Norte']);
    expect(vivo.sinReporte).toEqual(['Tijuana']);
    // "dato de hace…" es el de Centro, no las 2 h de Norte.
    expect(vivo.edadMaximaSegundos).toBe(30);

    const monitor = armarMonitor(filas, T0, T0);
    expect(vivo.total).toBe(monitor.kpis.enCurso);
    expect(vivo.mesas).toBe(monitor.kpis.mesas);
    expect(vivo.edadMaximaSegundos).toBe(monitor.kpis.ultimaLectura?.edadSegundos);
  });

  it('entre consultas el dato envejece y la sucursal se desconecta sola, como en el Monitor', () => {
    const filas = [
      fila('Centro', snapshot([{ total: '10.00' }], 30)),
      fila('Norte', snapshot([{ total: '5.00' }], 80)),
    ];
    expect(vivoEn(filas).total).toBe(1500n);
    // 11 s después Norte tiene 91 s: fuera de la suma.
    const tarde = vivoEn(filas, T0 + 11_000);
    expect(tarde.total).toBe(1000n);
    expect(tarde.desconectadas).toEqual(['Norte']);
    expect(tarde.total).toBe(armarMonitor(filas, T0, T0 + 11_000).kpis.enCurso);
  });

  it('todas desconectadas: ninguna conectada y sin edad (la tarjeta no inventa $0.00)', () => {
    const vivo = vivoEn([fila('Norte', snapshot([{ total: '5.00' }], 7200))]);
    expect(vivo.conectadas).toBe(0);
    expect(vivo.reportando).toBe(1);
    expect(vivo.desconectadas).toEqual(['Norte']);
    expect(vivo.edadMaximaSegundos).toBeNull();
  });

  it('si una sola mesa conectada no trae un total legible, no hay suma (nada de parciales)', () => {
    for (const mala of [{}, { total: 'mucho' }, { total: null }, { total: Number.NaN }]) {
      const vivo = vivoEn([fila('Centro', snapshot([{ total: '10.00' }, mala]))]);
      expect(vivo.total, JSON.stringify(mala)).toBeNull();
      expect(vivo.mesas).toBe(2);
    }
  });

  it('las sucursales sin snapshot se nombran y no cuentan', () => {
    const vivo = vivoEn([fila('Centro', snapshot([])), fila('Tijuana', null)]);
    expect(vivo.total).toBe(0n);
    expect(vivo.reportando).toBe(1);
    expect(vivo.sinReporte).toEqual(['Tijuana']);
  });

  it('sin ningún snapshot, nadie reporta', () => {
    const vivo = vivoEn([fila('Centro', null)]);
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

  it('una hora con importe ilegible es un hueco con "Sin dato", no $0.00', () => {
    const puntos = datosPorHora([
      { hora: 13, venta: '12,50', cuentas: 2 },
      { hora: 14, venta: '1e3', cuentas: 1 },
    ]);
    expect(puntos[13]).toMatchObject({ valor: null, texto: 'Sin dato', cuentas: 2 });
    expect(puntos[14]).toMatchObject({ valor: null, texto: 'Sin dato' });
    // Una hora que NO vino sigue siendo un cero real.
    expect(puntos[15]).toMatchObject({ valor: 0, texto: '$0.00' });
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

  it('un punto ilegible dice "Sin dato" en el tooltip', () => {
    const [punto] = datosPorHora([{ hora: 0, venta: 'x', cuentas: 3 }]);
    render(<TooltipHora active payload={[{ payload: punto }]} />);
    expect(screen.getByText('Sin dato')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('inactivo no pinta nada', () => {
    const { container } = render(<TooltipHora active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
