import { describe, expect, it } from 'vitest';

import type { ResumenClientes, SucursalClientes } from '../../api/tipos';
import { enlaceTickets, participacion, sinCuentasConCliente, vacio } from './reglas';

// Reglas de Clientes (F2-232).

const suc = (nombre: string, p: Partial<SucursalClientes>): SucursalClientes => ({
  sucursalId: nombre,
  sucursal: nombre,
  catalogo: 'con-clientes',
  clientesActivos: 1,
  cuentas: 10,
  cuentasConCliente: 1,
  ...p,
});

const resumen = (p: Partial<ResumenClientes>): ResumenClientes => ({
  usaClientes: true,
  catalogoTruncado: false,
  cuentas: 0,
  cuentasConCliente: 0,
  ventaConCliente: '0.00',
  sucursales: [],
  filas: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  ...p,
});

describe('vacio (F2-232)', () => {
  it('con clientes no hay estado vacío', () => {
    expect(vacio(resumen({})).tipo).toBe('hay');
  });

  it('vacío por sucursal: catálogo que llegó vacío y sucursales sin sincronizar, dicho así', () => {
    const v = vacio(
      resumen({
        usaClientes: false,
        sucursales: [
          suc('Centro', { catalogo: 'vacio', clientesActivos: 0, cuentasConCliente: 0 }),
          suc('Norte', { catalogo: 'sin-sincronizar', clientesActivos: 0, cuentasConCliente: 0 }),
          suc('Sur', { catalogo: 'sin-sincronizar', clientesActivos: 0, cuentasConCliente: 0 }),
        ],
      }),
    );
    expect(v.tipo).toBe('sin-clientes');
    if (v.tipo !== 'sin-clientes') return;
    expect(v.porque).toBe(
      'El catálogo de clientes de Centro llegó vacío y ninguna cuenta del periodo trae cliente. ' +
        'Norte, Sur todavía no han enviado su catálogo de clientes, y ninguna cuenta del periodo trae cliente.',
    );
    // Nunca afirma "el POS no usa clientes".
    expect(`${v.porque} ${v.falta}`).not.toMatch(/no usa clientes|no registra clientes/);
    expect(v.falta).toContain('lectura que falló');
  });
});

describe('sinCuentasConCliente / participacion (F2-232)', () => {
  it('sucursales con catálogo pero ninguna cuenta con cliente', () => {
    const r = resumen({
      sucursales: [suc('Centro', {}), suc('Norte', { cuentasConCliente: 0 })],
    });
    expect(sinCuentasConCliente(r).map((s) => s.sucursal)).toEqual(['Norte']);
  });

  it('participación con un decimal, sin cuentas dice que no hay', () => {
    expect(participacion(6, 8)).toBe('6 de 8 cuentas (75.0 %)');
    expect(participacion(1, 3)).toBe('1 de 3 cuentas (33.3 %)');
    expect(participacion(2, 3)).toBe('2 de 3 cuentas (66.7 %)');
    expect(participacion(0, 1)).toBe('0 de 1 cuenta (0.0 %)');
    expect(participacion(0, 0)).toBe('sin cuentas en el periodo');
  });
});

describe('enlaceTickets (F2-232)', () => {
  it('lleva alcance, periodo, el id y `canceladas=excluir`; nada propio de la vista', () => {
    const e = enlaceTickets(
      new URLSearchParams('empresa=e1&sucursal=s1&periodo=rango&desde=2026-09-01&hasta=2026-09-10&tab=x'),
      'c1',
    );
    expect(e.pathname).toBe('/tickets');
    const q = new URLSearchParams(e.search);
    expect(Object.fromEntries(q)).toEqual({
      empresa: 'e1',
      sucursal: 's1',
      periodo: 'rango',
      desde: '2026-09-01',
      hasta: '2026-09-10',
      cliente: 'c1',
      canceladas: 'excluir',
    });
  });
});
