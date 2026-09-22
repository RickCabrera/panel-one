import type {
  ConsumoTeorico,
  FilaConsumo,
  MotivoAparte,
  ProductoReceta,
  Recetas,
  SucursalConsumo,
} from '../../api/tipos';
import { cantidad } from '../tickets/formato';

/**
 * Reglas PURAS de la vista de Recetas (F2-125): textos, sentido de la variación, estados vacíos y
 * avisos por sucursal. Nada de números inventados: lo que el API no trae se dice.
 */

export const TEXTO_MOTIVO: Record<MotivoAparte, string> = {
  sin_receta: 'Sin receta',
  sin_catalogo: 'No está en el catálogo',
  ambiguo: 'Nombre repetido en el catálogo',
};

export const AYUDA_MOTIVO: Record<MotivoAparte, string> = {
  sin_receta: 'SoftRestaurant no tiene su receta (o la tiene vacía): no se sabe qué consume.',
  sin_catalogo:
    'El nombre del ticket no coincide con ningún producto del catálogo de esa sucursal.',
  ambiguo: 'Varios productos del catálogo se llaman igual: no se adivina cuál se vendió.',
};

export function nombreProducto(p: Pick<ProductoReceta, 'nombre' | 'productoOrigenSrId'>): string {
  return p.nombre ?? `Producto ${p.productoOrigenSrId} (no está en el catálogo)`;
}

export type Sentido = 'Faltante' | 'Sobrante' | 'Sin diferencia' | 'Sin lectura';

/**
 * Cómo leer la variación, en texto (la columna no depende del color): real mayor que el teórico =
 * salió más de lo que explican las ventas (faltante: posible merma o robo).
 */
export function sentidoVariacion(f: Pick<FilaConsumo, 'variacion'>): Sentido {
  if (f.variacion === null) return 'Sin lectura';
  const c = cantidad(f.variacion);
  if (c === '0') return 'Sin diferencia';
  return c.startsWith('-') ? 'Sobrante' : 'Faltante';
}

/** "+2.5", "−0.087", "0": el signo SIEMPRE visible. */
export function conSigno(texto: string): string {
  const c = cantidad(texto);
  if (c.startsWith('-')) return `−${c.slice(1)}`;
  return c === '0' ? '0' : `+${c}`;
}

/** "8.8 %", "−5.6 %"; nulo = "—". */
export function textoPorcentaje(p: string | null): string {
  if (p === null) return '—';
  return p.startsWith('-') ? `−${p.slice(1)} %` : `${p} %`;
}

/** Por qué una sucursal no entra al cálculo (o entra sin real). Nulo = entra completa. */
export function motivoSucursal(s: SucursalConsumo): string | null {
  if (!s.catalogoProductos) {
    return (
      `${s.sucursal}: su catálogo de productos nunca se ha sincronizado completo, así que lo ` +
      'vendido no se puede cruzar con recetas.'
    );
  }
  if (s.recetasRecibidas === 0) {
    return (
      `${s.sucursal}: todavía no ha mandado recetas. Las manda el agente cuando tenga el lector ` +
      'de recetas de SoftRestaurant (F2-241).'
    );
  }
  if (s.polizasRecibidas === 0) {
    return (
      `${s.sucursal}: sin pólizas de inventario recibidas, así que no hay consumo real con qué ` +
      'comparar (se muestra sólo el teórico).'
    );
  }
  return null;
}

export type VacioConsumo =
  | { tipo: 'con-datos' }
  | { tipo: 'sin-calculo'; porque: string[]; falta: string }
  | { tipo: 'periodo-vacio'; porque: string };

/**
 * ¿Hay algo que mostrar? Si NINGUNA sucursal del alcance se puede calcular, lo dice (y por qué);
 * si sí, pero el periodo no tiene ventas ni salidas, también. Nunca una tabla vacía muda.
 */
export function vacioConsumo(r: ConsumoTeorico): VacioConsumo {
  if (r.sucursales.every((s) => !s.calculada)) {
    return {
      tipo: 'sin-calculo',
      porque: r.sucursales.map((s) => motivoSucursal(s) ?? s.sucursal),
      falta:
        'Hace falta que el agente de la sucursal mande su catálogo de productos y sus recetas. ' +
        'Hasta entonces no hay consumo teórico que calcular.',
    };
  }
  if (r.filas.length === 0 && r.aparte.length === 0) {
    return {
      tipo: 'periodo-vacio',
      porque: 'En el periodo elegido no hubo ventas ni salidas de inventario que comparar.',
    };
  }
  return { tipo: 'con-datos' };
}

export type VacioRecetas =
  { tipo: 'con-datos' } | { tipo: 'sin-recetas'; porque: string; falta: string };

export function vacioRecetas(r: Recetas): VacioRecetas {
  if (r.productos.length === 0 || r.sucursales.every((s) => s.recetasRecibidas === 0)) {
    return {
      tipo: 'sin-recetas',
      porque:
        r.sucursales.length === 1
          ? `${r.sucursales[0].sucursal} todavía no ha mandado recetas.`
          : 'Ninguna sucursal ha mandado todavía sus recetas.',
      falta:
        'Las manda el agente de cada sucursal cuando tenga el lector de recetas de ' +
        'SoftRestaurant (F2-241).',
    };
  }
  return { tipo: 'con-datos' };
}

/** Búsqueda local por nombre o clave, sin distinguir mayúsculas. */
export function filtrarRecetas(productos: readonly ProductoReceta[], q: string): ProductoReceta[] {
  const t = q.trim().toLocaleLowerCase('es-MX');
  if (!t) return [...productos];
  return productos.filter((p) =>
    [p.nombre, p.clave, p.productoOrigenSrId].some(
      (x) => x !== null && x.toLocaleLowerCase('es-MX').includes(t),
    ),
  );
}
