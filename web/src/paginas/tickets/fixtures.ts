import type { Sucursal, Ticket } from '../../api/tipos';
import { SUCURSAL_A1, SUCURSAL_A2 } from '../../test/apiFalsa';

/** Tickets SINTÉTICOS para los tests de la vista. Nada es de un restaurante real. */
export function ticket(parcial: Partial<Ticket> = {}): Ticket {
  return {
    id: '0000000a-0000-4000-8000-000000000001',
    sucursalId: SUCURSAL_A1.id,
    folio: '1001',
    mesa: '5',
    mesero: 'Juan Pérez',
    comensales: 3,
    abiertoAt: '2026-09-21T02:00:00.000Z',
    // 21:30 del 20 de septiembre en CDMX; 20:30 en Tijuana; ya el 21 en UTC.
    cerradoAt: '2026-09-21T03:30:00.000Z',
    cancelado: false,
    subtotal: '1000.00',
    impuestos: '160.00',
    descuentos: '0.00',
    propina: '50.00',
    total: '1160.00',
    partidas: [
      {
        producto: 'Tacos al pastor',
        categoria: 'Tacos',
        cantidad: '2.000',
        precioUnit: '125.50',
        total: '251.00',
        modificadores: [
          { nombre: 'Sin cebolla', precio: '0.00' },
          { nombre: 'Extra queso', precio: '15.00' },
        ],
      },
      {
        producto: 'Arrachera',
        categoria: null,
        cantidad: '0.250',
        precioUnit: '800.00',
        total: '200.00',
        modificadores: [],
      },
    ],
    pagos: [
      { formaRaw: 'EFECTIVO', forma: 'efectivo', monto: '600.00' },
      { formaRaw: 'TARJETA DE CREDITO', forma: 'tarjeta', monto: '610.00' },
    ],
    ...parcial,
  };
}

export const SUCURSALES: ReadonlyMap<string, Sucursal> = new Map([
  [SUCURSAL_A1.id, SUCURSAL_A1],
  [SUCURSAL_A2.id, SUCURSAL_A2],
]);
