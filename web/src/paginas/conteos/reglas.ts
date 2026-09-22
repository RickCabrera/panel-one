import type {
  AlmacenConteo,
  ConteoResumen,
  Conteos,
  EstadoConteo,
  EstadoRenglonConteo,
  PartidaConteo,
} from '../../api/tipos';
import { fechaHoraEn, fechaParaTabla } from '../tickets/formato';

/**
 * Reglas PURAS de los conteos físicos (F2-123): textos, búsqueda, avance y estados vacíos.
 * Nada de números inventados: lo que no está contado o no tiene teórico se dice.
 */

export const TEXTO_ESTADO_CONTEO: Record<EstadoConteo, string> = {
  en_captura: 'En captura',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

export const TEXTO_RENGLON: Record<EstadoRenglonConteo, string> = {
  con_diferencia: 'Con diferencia',
  cuadra: 'Cuadra',
  sin_contar: 'Sin contar',
  sin_teorico: 'Sin teórico (no venía en la lectura)',
};

export function nombreArticulo(p: Pick<PartidaConteo, 'insumo' | 'insumoOrigenSrId'>): string {
  return p.insumo ?? `Insumo ${p.insumoOrigenSrId} (sin catálogo)`;
}

export function nombreAlmacenConteo(a: {
  almacen: string | null;
  almacenOrigenSrId: string;
}): string {
  return a.almacen ?? `Almacén ${a.almacenOrigenSrId} (sin catálogo)`;
}

export function alcanceConteo(c: Pick<ConteoResumen, 'grupoOrigenSrId' | 'grupo'>): string {
  if (c.grupoOrigenSrId === null) return 'Todos los artículos';
  return `Grupo ${c.grupo ?? `${c.grupoOrigenSrId} (sin catálogo)`}`;
}

/** "22/09/2026 09:30" en la zona de la SUCURSAL, nunca la del navegador. */
export function horaEn(zona: string, instante: string): string {
  const { fecha, hora } = fechaHoraEn(zona, instante);
  return `${fechaParaTabla(fecha)} ${hora}`;
}

/** Búsqueda rápida por nombre, clave o id del POS, sin distinguir mayúsculas ni acentos. */
export function buscar<T extends Pick<PartidaConteo, 'insumo' | 'clave' | 'insumoOrigenSrId'>>(
  partidas: readonly T[],
  q: string,
): T[] {
  const plano = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
  const buscado = plano(q.trim());
  if (buscado === '') return [...partidas];
  return partidas.filter((p) =>
    [p.insumo, p.clave, p.insumoOrigenSrId].some((v) => v !== null && plano(v).includes(buscado)),
  );
}

/** Almacenes en los que se puede crear un conteo: los que tienen lectura de existencias. */
export function almacenesContables(r: Conteos, sucursalId?: string): AlmacenConteo[] {
  return r.almacenes.filter(
    (a) => a.capturadoAt !== null && (sucursalId === undefined || a.sucursalId === sucursalId),
  );
}

export type VacioConteos =
  | { tipo: 'con-datos' }
  | { tipo: 'sin-lectura'; porque: string; falta: string }
  | { tipo: 'sin-conteos'; porque: string; falta: string };

/**
 * ¿Hay algo que mostrar? Sin conteos Y sin ningún almacén con lectura: se explica que sin lectura
 * de existencias no hay teórico contra qué contar. Sin conteos pero con almacenes: se invita a
 * crear el primero.
 */
export function vacioConteos(r: Conteos): VacioConteos {
  if (r.conteos.length > 0) return { tipo: 'con-datos' };
  if (almacenesContables(r).length === 0) {
    return {
      tipo: 'sin-lectura',
      porque:
        r.sucursales.length === 1
          ? `${r.sucursales[0].sucursal} todavía no ha mandado existencias de ningún almacén.`
          : 'Ninguna sucursal ha mandado todavía existencias de sus almacenes.',
      falta:
        'Un conteo se compara contra la última lectura de existencias del almacén, que manda el ' +
        'agente de la sucursal cuando tenga el lector de inventario de SoftRestaurant (F2-241). ' +
        'Sin esa lectura no hay teórico contra qué contar.',
    };
  }
  return {
    tipo: 'sin-conteos',
    porque: 'Todavía no hay conteos físicos en este alcance.',
    falta: 'Crea el primero: elige el almacén y, si quieres, un grupo de artículos.',
  };
}

export function avance(c: Pick<ConteoResumen, 'contados' | 'articulos'>): string {
  return `${c.contados} de ${c.articulos}`;
}
