import { Prisma } from '@prisma/client';

import {
  agruparMenu,
  llaveProducto,
  normalizarNombre,
  vendidosSinCatalogo,
  type FilaMenu,
  type Vendido,
} from './menu';

// La parte pura del orquestador de menú (F2-145). Los precios y nombres van escritos a mano:
// esto prueba la DETECCIÓN, no lo que el seed generó.

const S1 = 's1';
const S2 = 's2';
const S3 = 's3';
const ORDEN = [S1, S2, S3];
const D = (v: string) => new Prisma.Decimal(v);

let n = 0;
function fila(p: Partial<FilaMenu> & { sucursalId: string }): FilaMenu {
  n++;
  return {
    productoId: `id-${n}`,
    origenSrId: `O${n}`,
    clave: 'P009',
    nombre: 'Tacos al pastor',
    grupo: 'Platos fuertes',
    precio: D('89.00'),
    activoPos: true,
    tieneMetadata: false,
    ...p,
  };
}

const unico = (filas: FilaMenu[]) => {
  const m = agruparMenu(filas, ORDEN);
  expect(m.productos).toBe(1);
  return m.categorias[0].productos[0];
};

describe('normalizarNombre / llaveProducto', () => {
  it('ignora mayúsculas y espacios de más, pero no los acentos', () => {
    expect(normalizarNombre('  Tacos   AL pastor ')).toBe('tacos al pastor');
    expect(normalizarNombre('Café')).not.toBe(normalizarNombre('Cafe'));
  });

  it('cruza por clave si la hay y por nombre si no', () => {
    expect(llaveProducto({ clave: ' p009 ', nombre: 'x' })).toEqual({
      llave: 'c:P009',
      criterio: 'clave',
    });
    expect(llaveProducto({ clave: null, nombre: ' Flan ' })).toEqual({
      llave: 'n:flan',
      criterio: 'nombre',
    });
    expect(llaveProducto({ clave: '   ', nombre: 'Flan' }).criterio).toBe('nombre');
  });
});

describe('agruparMenu: discrepancia de precio', () => {
  it('la misma clave con precio distinto en dos sucursales se señala, con mín y máx', () => {
    const p = unico([
      fila({ sucursalId: S2, precio: D('95.00') }),
      fila({ sucursalId: S1, precio: D('89.00') }),
    ]);
    expect(p.discrepancia).toBe(true);
    expect(p.precioMin).toBe('89.00');
    expect(p.precioMax).toBe('95.00');
    // Columnas en el orden de las sucursales.
    expect(p.precios.map((x) => [x.sucursalId, x.precio])).toEqual([
      [S1, '89.00'],
      [S2, '95.00'],
    ]);
  });

  it('el mismo precio escrito distinto no es discrepancia (comparación decimal)', () => {
    const p = unico([
      fila({ sucursalId: S1, precio: D('89') }),
      fila({ sucursalId: S2, precio: D('89.00') }),
    ]);
    expect(p.discrepancia).toBe(false);
    expect(p.precioMin).toBe('89.00');
    expect(p.precioMax).toBe('89.00');
  });

  it('un precio nulo no dispara la discrepancia, pero se muestra', () => {
    const p = unico([
      fila({ sucursalId: S1, precio: D('89.00') }),
      fila({ sucursalId: S2, precio: null }),
    ]);
    expect(p.discrepancia).toBe(false);
    expect(p.precios[1].precio).toBeNull();
  });

  it('una fila dada de baja en el POS no dispara la discrepancia, pero sale marcada', () => {
    const p = unico([
      fila({ sucursalId: S1, precio: D('89.00') }),
      fila({ sucursalId: S2, precio: D('120.00'), activoPos: false }),
    ]);
    expect(p.discrepancia).toBe(false);
    expect(p.precios[1].vigente).toBe(false);
    expect(p.precioMax).toBe('89.00');
  });

  it('una sola sucursal nunca es discrepancia', () => {
    expect(unico([fila({ sucursalId: S1 })]).discrepancia).toBe(false);
  });

  it('tres sucursales, dos iguales y una distinta: se señala', () => {
    const p = unico([
      fila({ sucursalId: S1, precio: D('55.00') }),
      fila({ sucursalId: S2, precio: D('55.00') }),
      fila({ sucursalId: S3, precio: D('60.00') }),
    ]);
    expect(p.discrepancia).toBe(true);
    expect(p.precios).toHaveLength(3);
  });

  it('sin clave cruza por nombre normalizado; claves distintas no se cruzan', () => {
    const m = agruparMenu(
      [
        fila({ sucursalId: S1, clave: null, nombre: 'Flan napolitano', precio: D('68') }),
        fila({ sucursalId: S2, clave: null, nombre: ' flan  NAPOLITANO', precio: D('70') }),
        fila({ sucursalId: S1, clave: 'A1', nombre: 'Refresco' }),
        fila({ sucursalId: S2, clave: 'B1', nombre: 'Refresco' }),
      ],
      ORDEN,
    );
    expect(m.productos).toBe(3);
    const flan = m.categorias[0].productos.find((p) => p.criterio === 'nombre')!;
    expect(flan.discrepancia).toBe(true);
    expect(flan.nombre).toBe('Flan napolitano'); // el de la primera sucursal
    expect(m.discrepancias).toBe(1);
  });

  it('la misma clave dos veces en UNA sucursal se marca como duplicada', () => {
    const p = unico([
      fila({ sucursalId: S1, origenSrId: 'X1', precio: D('10') }),
      fila({ sucursalId: S1, origenSrId: 'X2', precio: D('12') }),
    ]);
    expect(p.duplicadoEnSucursal).toBe(true);
    expect(p.discrepancia).toBe(true);
    expect(p.precios.map((x) => x.origenSrId)).toEqual(['X1', 'X2']);
  });
});

describe('agruparMenu: categorías', () => {
  it('por grupo, en orden; sin grupo al final; productos por nombre', () => {
    const m = agruparMenu(
      [
        fila({ sucursalId: S1, clave: 'P1', nombre: 'Refresco', grupo: 'Bebidas' }),
        fila({ sucursalId: S1, clave: 'P2', nombre: 'Agua', grupo: 'bebidas ' }),
        fila({ sucursalId: S1, clave: 'P3', nombre: 'Suelto', grupo: null }),
        fila({ sucursalId: S1, clave: 'P4', nombre: 'Molletes', grupo: 'Desayunos' }),
      ],
      ORDEN,
    );
    expect(m.categorias.map((c) => c.grupo)).toEqual(['Bebidas', 'Desayunos', null]);
    expect(m.categorias[0].productos.map((p) => p.nombre)).toEqual(['Agua', 'Refresco']);
  });

  it('un producto en grupos distintos según la sucursal va al de la primera y se marca', () => {
    const m = agruparMenu(
      [
        fila({ sucursalId: S2, grupo: 'Especiales' }),
        fila({ sucursalId: S1, grupo: 'Platos fuertes' }),
      ],
      ORDEN,
    );
    expect(m.categorias.map((c) => c.grupo)).toEqual(['Platos fuertes']);
    expect(m.categorias[0].productos[0].gruposDistintos).toBe(true);
  });
});

describe('vendidosSinCatalogo', () => {
  const v = (p: Partial<Vendido> & { producto: string }): Vendido => ({
    sucursalId: S1,
    partidas: 1,
    cantidad: D('1.000'),
    importe: D('10.00'),
    ...p,
  });
  const catalogo = new Map([
    [S1, new Set(['tacos al pastor'])],
    [S2, new Set(['flan'])],
  ]);
  const conCatalogo = new Set([S1, S2]);

  it('lo que está en el catálogo (con otra escritura) no sale; lo que no, sí', () => {
    const r = vendidosSinCatalogo(
      [
        v({ producto: 'TACOS  al pastor ' }),
        v({ producto: 'Especial del día', importe: D('150') }),
      ],
      catalogo,
      conCatalogo,
    );
    expect(r.map((x) => x.producto)).toEqual(['Especial del día']);
  });

  it('el cruce es por sucursal: un nombre del catálogo de S1 vendido en S2 sale', () => {
    const r = vendidosSinCatalogo(
      [v({ producto: 'Tacos al pastor', sucursalId: S2 })],
      catalogo,
      conCatalogo,
    );
    expect(r).toHaveLength(1);
    expect(r[0].sucursalId).toBe(S2);
  });

  it('una sucursal sin catálogo completo no lista nada', () => {
    const r = vendidosSinCatalogo(
      [v({ producto: 'Cualquier cosa', sucursalId: S3 })],
      catalogo,
      conCatalogo,
    );
    expect(r).toEqual([]);
  });

  it('junta las variantes DESPUÉS de normalizar y suma en decimal', () => {
    const r = vendidosSinCatalogo(
      [
        v({ producto: 'Tacos ', partidas: 2, cantidad: D('2.500'), importe: D('0.10') }),
        v({ producto: 'tacos', partidas: 1, cantidad: D('0.250'), importe: D('0.20') }),
      ],
      catalogo,
      conCatalogo,
    );
    expect(r).toHaveLength(1);
    expect(r[0].variantes).toBe(2);
    expect(r[0].producto).toBe('tacos'); // la variante con más importe da el texto
    expect(r[0].partidas).toBe(3);
    expect(r[0].cantidad.toFixed(3)).toBe('2.750');
    expect(r[0].importe.toFixed(2)).toBe('0.30'); // 0.1 + 0.2 exacto
  });

  it('ordena por importe descendente', () => {
    const r = vendidosSinCatalogo(
      [
        v({ producto: 'A', importe: D('5') }),
        v({ producto: 'B', importe: D('50') }),
        v({ producto: 'C', importe: D('20') }),
      ],
      catalogo,
      conCatalogo,
    );
    expect(r.map((x) => x.producto)).toEqual(['B', 'C', 'A']);
  });
});
