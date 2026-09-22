import { Prisma } from '@prisma/client';

/**
 * La parte PURA del orquestador de menú (F2-145): cruzar el espejo de productos entre
 * sucursales, señalar precios distintos, y detectar lo vendido que no está en el catálogo.
 * Sin base de datos: la lectura (con el helper de scope) vive en `catalogos.service.ts`.
 *
 * El espejo es POR SUCURSAL (cada sucursal es su propio POS): "el mismo producto" en dos
 * sucursales no tiene una llave común garantizada. Ver `llaveProducto`.
 */

/** Tope de filas del espejo que lee el menú. Más = `truncado` y la vista lo dice. */
export const MAX_FILAS_MENU = 5000;
/** Tope de renglones de "vendidos sin catálogo". Más = `truncado` y la vista lo dice. */
export const MAX_SIN_CATALOGO = 500;

const CERO = new Prisma.Decimal(0);

/**
 * Un nombre comparable: sin espacios de más y sin distinguir mayúsculas. Los acentos SÍ
 * cuentan ("Café" y "Cafe" son distintos): quitarlos juntaría productos que el POS separa.
 */
export function normalizarNombre(nombre: string): string {
  return nombre.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
}

export type CriterioCruce = 'clave' | 'nombre';

/**
 * Con qué se reconoce el mismo producto en otra sucursal.
 *
 * DECISION PROVISIONAL (nocturno): por la CLAVE visible del POS (sin espacios, sin distinguir
 * mayúsculas); si el POS no trae clave, por el nombre normalizado. No se ha visto si dos
 * sucursales de SR comparten claves (esquema-sr.md §6): dos claves distintas para el mismo
 * platillo no se cruzan, y la misma clave para cosas distintas sí. Cada producto del menú dice
 * con qué criterio se cruzó para que la vista lo muestre.
 */
export function llaveProducto(f: { clave: string | null; nombre: string }): {
  llave: string;
  criterio: CriterioCruce;
} {
  const clave = f.clave?.trim();
  if (clave) {
    return { llave: `c:${clave.toLocaleUpperCase('es-MX')}`, criterio: 'clave' };
  }
  return { llave: `n:${normalizarNombre(f.nombre)}`, criterio: 'nombre' };
}

/** Una fila ACTIVA del espejo de productos (la vio la última sincronización completa). */
export interface FilaMenu {
  productoId: string;
  sucursalId: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  /** Nombre del grupo en SU sucursal; nulo si no tiene o aún no llegó. */
  grupo: string | null;
  precio: Prisma.Decimal | null;
  activoPos: boolean | null;
  tieneMetadata: boolean;
}

export interface PrecioEnSucursal {
  productoId: string;
  sucursalId: string;
  origenSrId: string;
  nombre: string;
  precio: string | null;
  /** false = el POS lo reporta dado de baja (`activoPos=false`): no cuenta para discrepancia. */
  vigente: boolean;
  tieneMetadata: boolean;
}

export interface ProductoMenu {
  llave: string;
  criterio: CriterioCruce;
  clave: string | null;
  nombre: string;
  grupo: string | null;
  /** Las sucursales lo tienen en grupos distintos; va en el de la primera sucursal. */
  gruposDistintos: boolean;
  /** Dos o más filas de la MISMA sucursal comparten la llave (la clave no es única en el POS). */
  duplicadoEnSucursal: boolean;
  /** Entre las filas vigentes con precio hay más de un precio distinto. */
  discrepancia: boolean;
  precioMin: string | null;
  precioMax: string | null;
  precios: PrecioEnSucursal[];
}

export interface CategoriaMenu {
  /** Nulo = sin grupo. Va al final. */
  grupo: string | null;
  productos: ProductoMenu[];
}

export interface MenuAgrupado {
  categorias: CategoriaMenu[];
  productos: number;
  discrepancias: number;
}

const comparar = (a: string, b: string) => a.localeCompare(b, 'es-MX');

/**
 * Agrupa el espejo por producto (`llaveProducto`) y por categoría. `ordenSucursales` fija
 * qué sucursal es "la primera" (de ella salen el nombre y el grupo que se muestran) y el
 * orden de las columnas de precio.
 */
export function agruparMenu(
  filas: readonly FilaMenu[],
  ordenSucursales: readonly string[],
): MenuAgrupado {
  const posicion = new Map(ordenSucursales.map((id, i) => [id, i]));
  const pos = (id: string) => posicion.get(id) ?? Number.MAX_SAFE_INTEGER;
  const ordenadas = [...filas].sort(
    (a, b) =>
      pos(a.sucursalId) - pos(b.sucursalId) ||
      comparar(a.origenSrId, b.origenSrId) ||
      comparar(a.productoId, b.productoId),
  );

  const porLlave = new Map<string, { criterio: CriterioCruce; filas: FilaMenu[] }>();
  for (const f of ordenadas) {
    const { llave, criterio } = llaveProducto(f);
    const g = porLlave.get(llave);
    if (g) {
      g.filas.push(f);
    } else {
      porLlave.set(llave, { criterio, filas: [f] });
    }
  }

  const productos: ProductoMenu[] = [];
  for (const [llave, { criterio, filas: grupoFilas }] of porLlave) {
    const primera = grupoFilas[0];
    const vigentesConPrecio = grupoFilas.filter((f) => f.activoPos !== false && f.precio !== null);
    const distintos: Prisma.Decimal[] = [];
    for (const f of vigentesConPrecio) {
      if (!distintos.some((d) => d.equals(f.precio!))) {
        distintos.push(f.precio!);
      }
    }
    const min = distintos.reduce<Prisma.Decimal | null>(
      (m, d) => (m === null || d.lessThan(m) ? d : m),
      null,
    );
    const max = distintos.reduce<Prisma.Decimal | null>(
      (m, d) => (m === null || d.greaterThan(m) ? d : m),
      null,
    );
    const gruposNorm = new Set(
      grupoFilas.map((f) => (f.grupo === null ? '' : normalizarNombre(f.grupo))),
    );
    const sucursales = new Set(grupoFilas.map((f) => f.sucursalId));
    productos.push({
      llave,
      criterio,
      clave: primera.clave,
      nombre: primera.nombre,
      grupo: primera.grupo,
      gruposDistintos: gruposNorm.size > 1,
      duplicadoEnSucursal: sucursales.size < grupoFilas.length,
      discrepancia: distintos.length > 1,
      precioMin: min?.toFixed(2) ?? null,
      precioMax: max?.toFixed(2) ?? null,
      precios: grupoFilas.map((f) => ({
        productoId: f.productoId,
        sucursalId: f.sucursalId,
        origenSrId: f.origenSrId,
        nombre: f.nombre,
        precio: f.precio?.toFixed(2) ?? null,
        vigente: f.activoPos !== false,
        tieneMetadata: f.tieneMetadata,
      })),
    });
  }

  // Categorías por nombre de grupo normalizado; se muestra el primero que se vio.
  const categorias = new Map<string, CategoriaMenu>();
  for (const p of productos) {
    const k = p.grupo === null ? '' : normalizarNombre(p.grupo);
    const c = categorias.get(k);
    if (c) {
      c.productos.push(p);
    } else {
      categorias.set(k, { grupo: p.grupo, productos: [p] });
    }
  }
  const lista = [...categorias.values()].sort((a, b) =>
    a.grupo === null ? 1 : b.grupo === null ? -1 : comparar(a.grupo, b.grupo),
  );
  for (const c of lista) {
    c.productos.sort((a, b) => comparar(a.nombre, b.nombre) || comparar(a.llave, b.llave));
  }
  return {
    categorias: lista,
    productos: productos.length,
    discrepancias: productos.filter((p) => p.discrepancia).length,
  };
}

// ---------------------------------------------------------------------------
// vendidos sin catálogo
// ---------------------------------------------------------------------------

/** Una fila de `partidas_ventas` agrupada por (sucursal, nombre CRUDO). */
export interface Vendido {
  sucursalId: string;
  producto: string;
  partidas: number;
  cantidad: Prisma.Decimal;
  importe: Prisma.Decimal;
}

export interface VendidoSinCatalogo {
  sucursalId: string;
  /** El nombre tal como llegó en la variante con MÁS importe (empate: orden alfabético). */
  producto: string;
  /** Cuántas escrituras distintas del mismo nombre se juntaron (mayúsculas, espacios). */
  variantes: number;
  partidas: number;
  cantidad: Prisma.Decimal;
  importe: Prisma.Decimal;
}

/**
 * Lo vendido cuyo nombre (normalizado) no está en el espejo de productos de SU sucursal.
 * Sólo se cruzan las sucursales de `conCatalogo` (con una sincronización COMPLETA de
 * productos): contra un catálogo parcial o ausente todo saldría "sin catálogo".
 *
 * Se agrupa DESPUÉS de normalizar: "Tacos " y "tacos" son un renglón, sumado en Decimal.
 * Orden: importe descendente, luego nombre.
 *
 * DECISION PROVISIONAL (nocturno): el cruce es por NOMBRE (el contrato de cheques no trae id de
 * producto, esquema-sr.md §6). Un producto renombrado en el POS dentro del periodo sale aquí
 * con su nombre viejo; uno cuyo nombre en el ticket difiere del del catálogo, también.
 */
export function vendidosSinCatalogo(
  vendidos: readonly Vendido[],
  catalogo: ReadonlyMap<string, ReadonlySet<string>>,
  conCatalogo: ReadonlySet<string>,
): VendidoSinCatalogo[] {
  const acumulado = new Map<string, VendidoSinCatalogo & { nombres: Set<string> }>();
  // La primera variante que se ve de cada nombre es la que da el texto: la de más importe.
  const ordenados = [...vendidos].sort(
    (a, b) =>
      comparar(a.sucursalId, b.sucursalId) ||
      b.importe.comparedTo(a.importe) ||
      comparar(a.producto, b.producto),
  );
  for (const v of ordenados) {
    if (!conCatalogo.has(v.sucursalId)) {
      continue;
    }
    const nombre = normalizarNombre(v.producto);
    if (catalogo.get(v.sucursalId)?.has(nombre)) {
      continue;
    }
    const k = `${v.sucursalId}|${nombre}`;
    const a = acumulado.get(k);
    if (a) {
      a.nombres.add(v.producto);
      a.partidas += v.partidas;
      a.cantidad = a.cantidad.plus(v.cantidad);
      a.importe = a.importe.plus(v.importe);
    } else {
      acumulado.set(k, {
        sucursalId: v.sucursalId,
        producto: v.producto,
        variantes: 1,
        nombres: new Set([v.producto]),
        partidas: v.partidas,
        cantidad: CERO.plus(v.cantidad),
        importe: CERO.plus(v.importe),
      });
    }
  }
  return [...acumulado.values()]
    .map(({ nombres, ...r }) => ({ ...r, variantes: nombres.size }))
    .sort(
      (a, b) =>
        b.importe.comparedTo(a.importe) ||
        comparar(a.producto, b.producto) ||
        comparar(a.sucursalId, b.sucursalId),
    );
}
