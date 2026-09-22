import type { Kardex, Movimientos, TipoPolizaInventario } from '../../api/tipos';
import { cantidad } from '../tickets/formato';

/**
 * Reglas PURAS de la vista de Movimientos (F2-122): textos del tipo, sentido de un movimiento,
 * estados vacíos y el cuadre del kardex contra la existencia leída. Nada de números inventados:
 * lo que el API no trae se dice.
 */

export const TEXTO_TIPO: Record<TipoPolizaInventario, string> = {
  inicial: 'Inventario inicial',
  compra: 'Compra',
  consumo: 'Consumo',
  merma: 'Merma',
  traspaso_salida: 'Traspaso (salida)',
  traspaso_entrada: 'Traspaso (entrada)',
  ajuste: 'Ajuste',
  // Lo que el lector no supo clasificar se dice, no se esconde.
  otro: 'Otro (sin traducir)',
};

export const TIPOS: TipoPolizaInventario[] = Object.keys(TEXTO_TIPO) as TipoPolizaInventario[];

export function leerTipo(valor: string): TipoPolizaInventario | null {
  return (TIPOS as string[]).includes(valor) ? (valor as TipoPolizaInventario) : null;
}

/** Un artículo en SU almacén: lo que identifica un kardex. */
export interface Articulo {
  sucursalId: string;
  almacenOrigenSrId: string;
  insumoOrigenSrId: string;
}

export function nombreInsumo(f: { insumo: string | null; insumoOrigenSrId: string }): string {
  return f.insumo ?? `Insumo ${f.insumoOrigenSrId} (sin catálogo)`;
}

/** "+5", "−2.5", "0": el signo SIEMPRE visible (la columna no depende del color). */
export function cantidadConSigno(texto: string): string {
  const c = cantidad(texto);
  if (c.startsWith('-')) return `−${c.slice(1)}`;
  return c === '0' ? '0' : `+${c}`;
}

export function sentido(texto: string): 'Entrada' | 'Salida' | 'Sin movimiento' {
  const c = cantidad(texto);
  if (c === '0') return 'Sin movimiento';
  return c.startsWith('-') ? 'Salida' : 'Entrada';
}

export type Vacio =
  | { tipo: 'con-datos' }
  | { tipo: 'sin-movimientos'; porque: string; falta: string }
  | { tipo: 'periodo-vacio'; porque: string };

/**
 * ¿Hay algo que mostrar? Si NINGUNA sucursal del alcance ha mandado pólizas, la vista lo dice (y
 * por qué); si sí mandó pero el periodo o el filtro no tiene movimientos, también lo dice. Nunca
 * una tabla vacía sin explicación.
 */
export function vacio(r: Movimientos, conFiltros: boolean): Vacio {
  if (r.sucursales.every((s) => s.polizasRecibidas === 0)) {
    return {
      tipo: 'sin-movimientos',
      porque:
        r.sucursales.length === 1
          ? `${r.sucursales[0].sucursal} todavía no ha mandado movimientos de inventario.`
          : 'Ninguna sucursal ha mandado todavía movimientos de inventario.',
      falta:
        'Los manda el agente de cada sucursal cuando tenga el lector de inventario de ' +
        'SoftRestaurant (F2-241). Mientras tanto no hay pólizas ni kardex que mostrar.',
    };
  }
  if (r.total === 0) {
    return {
      tipo: 'periodo-vacio',
      porque: conFiltros
        ? 'No hay movimientos con estos filtros en el periodo elegido.'
        : 'No hay movimientos en el periodo elegido.',
    };
  }
  return { tipo: 'con-datos' };
}

/** Sucursales del alcance que nunca mandaron pólizas (para el aviso). */
export function sucursalesSinMovimientos(r: Movimientos): string[] {
  return r.sucursales.filter((s) => s.polizasRecibidas === 0).map((s) => s.sucursal);
}

export type Cuadre =
  | { tipo: 'cuadra'; texto: string }
  | { tipo: 'diferencia'; texto: string }
  | { tipo: 'sin-comparar'; texto: string };

/**
 * El cuadre del kardex contra la existencia de la última lectura, dicho en palabras. Sin
 * movimientos o sin existencia leída no hay "diferencia": no hay con qué comparar, y se dice.
 */
export function cuadreDe(k: Kardex, horaCorte: string | null): Cuadre {
  if (k.polizasRecibidas === 0) {
    return {
      tipo: 'sin-comparar',
      texto: 'La sucursal todavía no manda movimientos: no hay kardex con qué comparar.',
    };
  }
  if (k.cuadra === null || k.existencia === null || horaCorte === null) {
    return {
      tipo: 'sin-comparar',
      texto:
        'Sin lectura de existencias de este artículo en este almacén: no hay con qué comparar.',
    };
  }
  if (k.cuadra) {
    return {
      tipo: 'cuadra',
      texto: `Cuadra con la existencia leída el ${horaCorte}: ${cantidad(k.existencia)}.`,
    };
  }
  return {
    tipo: 'diferencia',
    texto:
      `La existencia leída el ${horaCorte} es ${cantidad(k.existencia)}, pero los movimientos ` +
      `hasta ese corte suman ${cantidad(k.saldoAlCorte ?? '0')}: diferencia de ` +
      `${cantidadConSigno(k.diferencia ?? '0')}.`,
  };
}
