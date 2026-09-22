import { describe, expect, it } from 'vitest';

import type { CeldaHoraDia, VentaHoraDia, VentaMesa, VentaMesero } from '../../api/tipos';
import {
  armarMapa,
  canceladosDe,
  DEJO,
  extremos,
  movimientos,
  NUEVO,
  ordenarMesas,
  ordenarMeseros,
  paginar,
  sumaImportes,
} from './reglas';

function mesero(p: Partial<VentaMesero> & Pick<VentaMesero, 'mesero'>): VentaMesero {
  return {
    sucursalId: 's1',
    sucursal: 'Centro',
    venta: '0.00',
    cuentas: 0,
    ticketPromedio: null,
    comensales: 0,
    cuentasConComensales: 0,
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cancelados: { cuentas: 0, monto: '0.00' },
    minutosPromedio: null,
    cuentasConDuracion: 0,
    ...p,
  };
}

describe('paginar', () => {
  const filas = Array.from({ length: 601 }, (_, i) => i);

  it('parte en páginas de 50 y la última lleva el resto', () => {
    const p = paginar(filas, 13);
    expect(p).toMatchObject({ pagina: 13, paginas: 13, total: 601 });
    expect(p.filas).toEqual([600]);
    expect(paginar(filas, 1).filas).toHaveLength(50);
  });

  it('acota una página fuera de rango y sin filas deja una sola página vacía', () => {
    expect(paginar(filas, 99).pagina).toBe(13);
    expect(paginar(filas, 0).pagina).toBe(1);
    expect(paginar([], 3)).toEqual({ filas: [], pagina: 1, paginas: 1, total: 0 });
  });
});

describe('sumaImportes', () => {
  it('suma exacto en centavos y no inventa total si algo es ilegible', () => {
    expect(sumaImportes(['0.10', '0.20', '-0.05'])).toBe(25n);
    expect(sumaImportes(['1.00', 'x'])).toBeNull();
  });
});

describe('meseros', () => {
  const ana = mesero({ mesero: 'Ana', venta: '300.00', cuentas: 3, ticketPromedio: '100.00' });
  const anaNorte = mesero({
    mesero: 'Ana',
    sucursalId: 's2',
    sucursal: 'Norte',
    venta: '300.00',
    cuentas: 1,
    ticketPromedio: '300.00',
  });
  const soloCancelados = mesero({ mesero: 'Pedro', cancelados: { cuentas: 2, monto: '40.00' } });
  const sin = mesero({ mesero: null, venta: '50.00', cuentas: 1, ticketPromedio: '50.00' });

  it('ranking por venta con empate por sucursal; la misma Ana en dos sucursales son dos filas', () => {
    const r = ordenarMeseros([sin, anaNorte, soloCancelados, ana], 'venta');
    expect(r.map((m) => [m.fila.mesero, m.fila.sucursal, m.posicion])).toEqual([
      ['Ana', 'Centro', 1],
      ['Ana', 'Norte', 2],
      [null, 'Centro', 3],
      ['Pedro', 'Centro', 4],
    ]);
  });

  it('por ticket promedio, quien no tiene cuentas va al final sin posición', () => {
    const r = ordenarMeseros([soloCancelados, ana, anaNorte], 'ticketPromedio');
    expect(r.map((m) => [m.fila.sucursal, m.fila.mesero, m.posicion])).toEqual([
      ['Norte', 'Ana', 1],
      ['Centro', 'Ana', 2],
      ['Centro', 'Pedro', null],
    ]);
  });

  it('los cancelados se suman aparte', () => {
    expect(canceladosDe([ana, soloCancelados])).toEqual({ cuentas: 2, monto: 4000n });
  });
});

describe('movimientos de productos', () => {
  const p = (producto: string, importe: string) => ({ producto, importe, cantidad: '1.000' });

  it('Δ por nombre: sube, cae, nuevo y dejó de venderse; ordena por diferencia', () => {
    const ms = movimientos(
      [p('Taco', '150.00'), p('Agua', '10.00'), p('Pozole', '80.00'), p('Café', '30.00')],
      [p('Taco', '100.00'), p('Agua', '40.00'), p('Torta', '70.00'), p('Café', '30.00')],
    );
    const { subieron, cayeron } = extremos(ms);
    expect(subieron.map((m) => [m.producto, m.diferencia])).toEqual([
      ['Pozole', 8000n],
      ['Taco', 5000n],
    ]);
    expect(cayeron.map((m) => [m.producto, m.diferencia])).toEqual([
      ['Torta', -7000n],
      ['Agua', -3000n],
    ]);
    expect(subieron[0].delta).toEqual({ tipo: 'sinBase', razon: NUEVO });
    expect(subieron[1].delta).toMatchObject({ tipo: 'cambio', porcentaje: '+50.0 %' });
    expect(cayeron[0].delta).toEqual({ tipo: 'sinBase', razon: DEJO });
    // Café no cambió: no está en ninguna lista.
    expect([...subieron, ...cayeron].some((m) => m.producto === 'Café')).toBe(false);
  });

  it('un importe ilegible saca al producto (no se ordena lo que no se lee) y corta a 5', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => p(`P${i}`, `${(i + 1) * 10}.00`));
    const ms = movimientos([...muchos, p('Roto', 'abc')], [p('Roto', '10.00')]);
    expect(ms.some((m) => m.producto === 'Roto')).toBe(false);
    expect(extremos(ms).subieron.map((m) => m.producto)).toEqual(['P7', 'P6', 'P5', 'P4', 'P3']);
  });
});

describe('mapa de calor', () => {
  function datos(celdas: Partial<CeldaHoraDia>[], dias = [1, 1, 0, 0, 0, 0, 0]): VentaHoraDia {
    const todas: CeldaHoraDia[] = [];
    for (let d = 1; d <= 7; d++) {
      for (let h = 0; h < 24; h++) {
        const c = celdas.find((x) => x.diaSemana === d && x.hora === h);
        todas.push({ diaSemana: d, hora: h, venta: '0.00', cuentas: 0, ...c });
      }
    }
    return { celdas: todas, diasEnRango: dias.map((n, i) => ({ diaSemana: i + 1, dias: n })) };
  }

  it('distingue sin ventas, cero pesos, fuera del periodo y niveles por quintil', () => {
    const m = armarMapa(
      datos([
        { diaSemana: 1, hora: 14, venta: '1000.00', cuentas: 5 },
        { diaSemana: 1, hora: 15, venta: '0.01', cuentas: 1 },
        { diaSemana: 1, hora: 16, venta: '600.00', cuentas: 2 },
        { diaSemana: 2, hora: 9, venta: '0.00', cuentas: 2 },
        { diaSemana: 2, hora: 10, venta: '-5.00', cuentas: 1 },
      ]),
    );
    const t = (d: number, h: number) => m.filas[d - 1].celdas[h].tipo;
    expect(t(1, 14)).toMatchObject({ tipo: 'venta', nivel: 5 });
    expect(t(1, 15)).toMatchObject({ tipo: 'venta', nivel: 1 });
    expect(t(1, 16)).toMatchObject({ tipo: 'venta', nivel: 3 });
    expect(t(2, 9)).toEqual({ tipo: 'ceroPesos', cuentas: 2 });
    expect(t(2, 10)).toMatchObject({ tipo: 'negativa', centavos: -500n });
    expect(t(1, 0)).toEqual({ tipo: 'sinVentas' });
    expect(t(3, 14)).toEqual({ tipo: 'fueraDePeriodo' });
    expect(m.filas[2].enPeriodo).toBe(false);
    expect(m.maximo).toBe(100000n);
    expect(m.conVentas).toBe(true);
  });

  it('sin ninguna cuenta no hay mapa que pintar; sólo cuentas en cero no tiene máximo', () => {
    expect(armarMapa(datos([])).conVentas).toBe(false);
    const cero = armarMapa(datos([{ diaSemana: 1, hora: 3, venta: '0.00', cuentas: 1 }]));
    expect(cero.conVentas).toBe(true);
    expect(cero.maximo).toBeNull();
  });
});

describe('mesas', () => {
  const m = (p: Partial<VentaMesa>): VentaMesa => ({
    sucursalId: 's1',
    sucursal: 'Centro',
    mesa: '1',
    cuentas: 1,
    venta: '10.00',
    minutosPromedio: '30.0',
    cuentasConDuracion: 1,
    ...p,
  });

  it('ordena por mesa con orden natural (M2 antes que M10) y por minutos con null al final', () => {
    const filas = [
      m({ mesa: 'M10', minutosPromedio: null }),
      m({ mesa: 'M2', minutosPromedio: '45.5' }),
      m({ mesa: 'M1', minutosPromedio: '60.0', sucursal: 'Norte', sucursalId: 's2' }),
    ];
    expect(ordenarMesas(filas, 'mesa').map((f) => f.mesa)).toEqual(['M2', 'M10', 'M1']);
    expect(ordenarMesas(filas, 'minutos').map((f) => f.mesa)).toEqual(['M1', 'M2', 'M10']);
  });

  it('por cuentas (rotación), la más usada primero', () => {
    const filas = [m({ mesa: 'A', cuentas: 2 }), m({ mesa: 'B', cuentas: 9 })];
    expect(ordenarMesas(filas, 'cuentas').map((f) => f.mesa)).toEqual(['B', 'A']);
  });
});
