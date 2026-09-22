import { Prisma } from '@prisma/client';

import {
  cifrasDe,
  estadoCatalogo,
  resumenClientes,
  type CifrasClienteLeidas,
  type ClienteLeido,
  type EntradaResumen,
  type SucursalClientesLeida,
} from './clientes';

// La parte pura de Clientes (F2-232). Cifras y espejo escritos a mano: lo esperado se calculó
// aquí. OJO: en el seed `origenSrId = clave`, así que un cruce por clave pasaría con el seed;
// aquí la clave y el id del POS son DISTINTOS a propósito.

const D = (v: string) => new Prisma.Decimal(v);
const S1 = 's1';
const S2 = 's2';

function sucursal(id: string, extra: Partial<SucursalClientesLeida> = {}): SucursalClientesLeida {
  return {
    id,
    nombre: id === S1 ? 'Centro' : 'Norte',
    sincronizado: true,
    clientesActivos: 2,
    cuentas: 10,
    cuentasConCliente: 3,
    ...extra,
  };
}

function cliente(id: string, origenSrId: string, extra: Partial<ClienteLeido> = {}): ClienteLeido {
  return {
    id,
    sucursalId: S1,
    origenSrId,
    clave: `C-${id}`,
    nombre: `Cliente ${id}`,
    activo: true,
    activoPos: null,
    vistoAt: new Date('2026-09-01T10:00:00Z'),
    telefono: '555-010-0001',
    correo: 'x@ejemplo.test',
    rfc: 'XAXX010101000',
    ...extra,
  };
}

function cifra(origenSrId: string, extra: Partial<CifrasClienteLeidas> = {}): CifrasClienteLeidas {
  return {
    sucursalId: S1,
    origenSrId,
    visitas: 1,
    venta: D('100.00'),
    ultimaVisita: new Date('2026-09-10T18:00:00Z'),
    canceladas: 0,
    montoCancelado: D('0'),
    ...extra,
  };
}

function entrada(extra: Partial<EntradaResumen> = {}): EntradaResumen {
  return {
    cifras: [],
    clientes: [],
    catalogoTruncado: false,
    sucursales: [sucursal(S1)],
    pagina: 1,
    porPagina: 50,
    contacto: false,
    ...extra,
  };
}

describe('cifrasDe (F2-232)', () => {
  it('ticket promedio = venta / visitas a 2 decimales mitad lejos de cero', () => {
    // 100.01 / 3 = 33.3366… → 33.34; 0.05 / 2 = 0.025 → 0.03 (mitad: hacia arriba).
    expect(cifrasDe(cifra('x', { visitas: 3, venta: D('100.01') })).ticketPromedio).toBe('33.34');
    expect(cifrasDe(cifra('x', { visitas: 2, venta: D('0.05') })).ticketPromedio).toBe('0.03');
  });

  it('sin visitas: ticket y última visita nulos, nunca 0.00 inventado', () => {
    expect(cifrasDe(undefined)).toEqual({
      visitas: 0,
      venta: '0.00',
      ticketPromedio: null,
      ultimaVisita: null,
      canceladas: { cuentas: 0, monto: '0.00' },
    });
    // Sólo canceladas: la venta sigue en 0 y el ticket nulo.
    const soloCanceladas = cifrasDe(
      cifra('x', {
        visitas: 0,
        venta: D('0'),
        ultimaVisita: null,
        canceladas: 2,
        montoCancelado: D('80.5'),
      }),
    );
    expect(soloCanceladas).toMatchObject({
      venta: '0.00',
      ticketPromedio: null,
      canceladas: { cuentas: 2, monto: '80.50' },
    });
  });
});

describe('estadoCatalogo (F2-232)', () => {
  it('sin sincronizar / vacío / con clientes', () => {
    expect(estadoCatalogo(sucursal(S1, { sincronizado: false, clientesActivos: 5 }))).toBe(
      'sin-sincronizar',
    );
    expect(estadoCatalogo(sucursal(S1, { clientesActivos: 0 }))).toBe('vacio');
    expect(estadoCatalogo(sucursal(S1))).toBe('con-clientes');
  });
});

describe('resumenClientes (F2-232)', () => {
  it('liga por (sucursal, id del POS) EXACTO: una clave igual con otro id NO liga', () => {
    const r = resumenClientes(
      entrada({
        // La cuenta trae el id "SR-17"; el cliente cuya CLAVE es "SR-17" tiene otro id.
        clientes: [cliente('a', 'SR-99', { clave: 'SR-17' }), cliente('b', 'SR-17')],
        cifras: [cifra('SR-17', { visitas: 2, venta: D('150.00') })],
      }),
    );
    const b = r.filas.find((f) => f.id === 'b')!;
    expect(b).toMatchObject({ cruce: 'ficha', visitas: 2, venta: '150.00', origenSrId: 'SR-17' });
    expect(r.filas.find((f) => f.id === 'a')).toMatchObject({ visitas: 0, venta: '0.00' });
  });

  it('el mismo id del POS en otra sucursal es otro cliente', () => {
    const r = resumenClientes(
      entrada({
        sucursales: [sucursal(S1), sucursal(S2)],
        clientes: [cliente('a', 'SR-1')],
        cifras: [cifra('SR-1', { sucursalId: S2, visitas: 4 })],
      }),
    );
    expect(r.filas.find((f) => f.id === 'a')).toMatchObject({ visitas: 0 });
    expect(r.filas.find((f) => f.sucursalId === S2)).toMatchObject({
      id: null,
      cruce: 'sin-ficha',
      visitas: 4,
      sucursal: 'Norte',
    });
  });

  it('un id que no está en el espejo sale sin ficha, sin nombre ni datos inventados', () => {
    const r = resumenClientes(entrada({ cifras: [cifra('SR-5')], contacto: true }));
    expect(r.filas).toEqual([
      expect.objectContaining({
        id: null,
        cruce: 'sin-ficha',
        origenSrId: 'SR-5',
        clave: null,
        nombre: null,
        activo: null,
        telefono: null,
        correo: null,
        rfc: null,
      }),
    ]);
  });

  it('sucursal sin catálogo sincronizado: no se afirma que falta la ficha', () => {
    const r = resumenClientes(
      entrada({
        sucursales: [sucursal(S1, { sincronizado: false, clientesActivos: 0 })],
        cifras: [cifra('SR-5')],
      }),
    );
    expect(r.filas[0].cruce).toBe('sin-sincronizar');
  });

  it('truncado: un cliente con visitas que llegó por la lectura de ids SÍ liga', () => {
    // La lista truncada no lo trae; la lectura por los ids de las cuentas sí.
    const lista = [cliente('a', 'SR-1')];
    const ligados = [cliente('z', 'SR-9000')];
    const r = resumenClientes(
      entrada({
        clientes: [...lista, ...ligados, cliente('a', 'SR-1')],
        catalogoTruncado: true,
        cifras: [cifra('SR-9000', { visitas: 3 })],
      }),
    );
    expect(r.catalogoTruncado).toBe(true);
    expect(r.filas.find((f) => f.origenSrId === 'SR-9000')).toMatchObject({
      id: 'z',
      cruce: 'ficha',
      visitas: 3,
    });
    // Leído dos veces (lista y por id): una sola fila.
    expect(r.filas.filter((f) => f.id === 'a')).toHaveLength(1);
  });

  it('un dado de baja sólo aparece si tuvo visitas o canceladas en el periodo', () => {
    const r = resumenClientes(
      entrada({
        clientes: [
          cliente('baja-sin', 'SR-1', { activo: false }),
          cliente('baja-con', 'SR-2', { activo: false }),
          cliente('baja-cancela', 'SR-3', { activo: false }),
        ],
        cifras: [
          cifra('SR-2'),
          cifra('SR-3', { visitas: 0, venta: D('0'), canceladas: 1, montoCancelado: D('10') }),
        ],
      }),
    );
    expect(r.filas.map((f) => f.id).sort()).toEqual(['baja-cancela', 'baja-con']);
  });

  it('orden: visitas desc, venta desc, nombre; los sin ficha al final entre iguales', () => {
    const r = resumenClientes(
      entrada({
        clientes: [
          cliente('b', 'SR-B', { nombre: 'Beto' }),
          cliente('a', 'SR-A', { nombre: 'Ana' }),
          cliente('c', 'SR-C', { nombre: 'Carla' }),
          cliente('d', 'SR-D', { nombre: 'Dora' }),
        ],
        cifras: [
          cifra('SR-C', { visitas: 5 }),
          cifra('SR-B', { visitas: 2, venta: D('300') }),
          cifra('SR-X', { visitas: 2, venta: D('300') }),
          cifra('SR-D', { visitas: 2, venta: D('90') }),
        ],
      }),
    );
    expect(r.filas.map((f) => f.nombre ?? f.origenSrId)).toEqual([
      'Carla',
      'Beto',
      'SR-X',
      'Dora',
      'Ana',
    ]);
  });

  it('q filtra por nombre, clave o id sin distinguir mayúsculas; total cuenta antes de paginar', () => {
    const clientes = [
      cliente('a', 'SR-1', { nombre: 'Ana López', clave: 'K1' }),
      cliente('b', 'SR-2', { nombre: 'Beto', clave: 'LOPE' }),
      cliente('c', 'SR-3', { nombre: 'Carla' }),
    ];
    const r = resumenClientes(entrada({ clientes, q: 'lóp' }));
    expect(r.filas.map((f) => f.id)).toEqual(['a']);
    expect(resumenClientes(entrada({ clientes, q: 'lope' })).filas.map((f) => f.id)).toEqual([
      'b',
    ]);
    const pag = resumenClientes(entrada({ clientes, porPagina: 2, pagina: 2 }));
    expect(pag.total).toBe(3);
    expect(pag.filas).toHaveLength(1);
  });

  it('sin `contacto` las llaves de teléfono, correo y RFC no vienen; con él, sí', () => {
    const clientes = [cliente('a', 'SR-1')];
    const sin = resumenClientes(entrada({ clientes })).filas[0];
    expect(Object.keys(sin)).not.toEqual(expect.arrayContaining(['telefono']));
    expect(JSON.stringify(sin)).not.toMatch(/555-010|ejemplo\.test|XAXX/);
    const con = resumenClientes(entrada({ clientes, contacto: true })).filas[0];
    expect(con).toMatchObject({
      telefono: '555-010-0001',
      correo: 'x@ejemplo.test',
      rfc: 'XAXX010101000',
    });
  });

  it('totales y usaClientes', () => {
    const vacio = resumenClientes(
      entrada({ sucursales: [sucursal(S1, { clientesActivos: 0, cuentasConCliente: 0 })] }),
    );
    expect(vacio).toMatchObject({ usaClientes: false, filas: [], total: 0 });
    expect(vacio.sucursales[0].catalogo).toBe('vacio');

    // Espejo vacío pero cuentas con cliente: sí usa clientes (lo derivable por id).
    const soloCuentas = resumenClientes(
      entrada({
        sucursales: [sucursal(S1, { clientesActivos: 0, cuentasConCliente: 1 })],
        cifras: [cifra('SR-1', { venta: D('10.10') }), cifra('SR-2', { venta: D('0.20') })],
      }),
    );
    expect(soloCuentas).toMatchObject({ usaClientes: true, ventaConCliente: '10.30' });
  });
});
