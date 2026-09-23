import type {
  AvisoProyeccion,
  FilaProyeccion,
  Proyecciones,
  SucursalProyeccion,
} from '../../api/tipos';
import { armarCsv, campo, texto } from '../../csv/csv';
import { cantidad, fechaParaTabla } from '../tickets/formato';

/**
 * Reglas PURAS de la vista de Proyecciones (F2-127): textos de avisos y estados, filtros locales,
 * el horizonte, los estados vacíos y el CSV de la orden de compra. Nada de números inventados:
 * un artículo sin historial dice "sin datos", nunca 0.
 */

export const HORIZONTE_MIN = 1;
export const HORIZONTE_MAX = 28;
export const HORIZONTE_DEFECTO = 7;
export const ATAJOS_HORIZONTE = [7, 14, 28] as const;
/** Días de historial que pide la proyección: 4 semanas completas. */
export const DIAS_VENTANA = 28;

/** Un horizonte escrito a mano: entero entre 1 y 28; lo demás, nulo (no se consulta). */
export function leerHorizonte(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= HORIZONTE_MIN && n <= HORIZONTE_MAX ? n : null;
}

export const TEXTO_AVISO: Record<AvisoProyeccion, string> = {
  sin_foto: 'Su almacén no tiene lectura de existencias: no se sugiere nada',
  fuera_de_foto: 'No viene en la última lectura del almacén: se toma existencia 0',
  foto_atrasada: 'La lectura de existencias va atrasada (más de 90 min)',
  sin_minimo: 'Sin mínimo en el panel: se toma 0',
};

export function nombreInsumo(f: Pick<FilaProyeccion, 'insumo' | 'insumoOrigenSrId'>): string {
  return f.insumo ?? `Insumo ${f.insumoOrigenSrId} (sin catálogo)`;
}

export function nombreAlmacen(f: Pick<FilaProyeccion, 'almacen' | 'almacenOrigenSrId'>): string {
  return f.almacen ?? `Almacén ${f.almacenOrigenSrId} (sin catálogo)`;
}

/** "Sin datos: 10 días de historial; la proyección necesita 28." */
export function textoSinHistorial(f: Pick<FilaProyeccion, 'diasHistorial'>): string {
  const d = f.diasHistorial;
  const lleva =
    d === 0 ? 'sin movimientos todavía' : `${d} ${d === 1 ? 'día' : 'días'} de historial`;
  return `Sin datos: ${lleva}; la proyección necesita ${DIAS_VENTANA}.`;
}

/** Cantidad visible: "12.5"; nulo = "—". */
export function cant(v: string | null): string {
  return v === null ? '—' : cantidad(v);
}

/** ¿Hay algo que comprar? Sólo un sugerido conocido y mayor que 0. */
export function conSugerido(f: Pick<FilaProyeccion, 'sugerido'>): boolean {
  return f.sugerido !== null && Number(f.sugerido) > 0;
}

/** Valor de un `<select>` de almacén: sucursal y almacén juntos (un almacén es de una sucursal). */
export function valorAlmacen(f: { sucursalId: string; almacenOrigenSrId: string }): string {
  return JSON.stringify([f.sucursalId, f.almacenOrigenSrId]);
}

/** Los almacenes que aparecen en las filas, en el orden de las filas, sin repetir. */
export function almacenesDe(
  filas: readonly FilaProyeccion[],
): Array<Pick<FilaProyeccion, 'sucursalId' | 'sucursal' | 'almacenOrigenSrId' | 'almacen'>> {
  const vistos = new Map<
    string,
    Pick<FilaProyeccion, 'sucursalId' | 'sucursal' | 'almacenOrigenSrId' | 'almacen'>
  >();
  for (const f of filas) {
    const k = valorAlmacen(f);
    if (!vistos.has(k)) {
      vistos.set(k, {
        sucursalId: f.sucursalId,
        sucursal: f.sucursal,
        almacenOrigenSrId: f.almacenOrigenSrId,
        almacen: f.almacen,
      });
    }
  }
  return [...vistos.values()];
}

export interface FiltroLocal {
  /** `valorAlmacen` o "" = todos. */
  almacen: string;
  q: string;
  soloSugerido: boolean;
}

export function filtrar(filas: readonly FilaProyeccion[], f: FiltroLocal): FilaProyeccion[] {
  const buscado = f.q.trim().toLocaleLowerCase('es');
  return filas.filter(
    (x) =>
      (f.almacen === '' || valorAlmacen(x) === f.almacen) &&
      (!f.soloSugerido || conSugerido(x)) &&
      (buscado === '' ||
        [x.insumo, x.clave, x.insumoOrigenSrId].some(
          (v) => v !== null && v.toLocaleLowerCase('es').includes(buscado),
        )),
  );
}

/** Por qué una sucursal no se proyecta. Nulo = se proyecta. */
export function motivoSucursal(s: SucursalProyeccion): string | null {
  if (s.calculada) return null;
  return (
    `${s.sucursal}: el agente nunca ha mandado pólizas de inventario, así que no hay consumo ` +
    'con qué proyectar. Las manda cuando tenga el lector de inventario de SoftRestaurant (F2-241).'
  );
}

export type Vacio = { tipo: 'con-datos' } | { tipo: 'sin-datos'; porque: string; falta: string };

/** Si NINGUNA sucursal del alcance se puede proyectar, se dice por qué en vez de una tabla vacía. */
export function vacio(r: Proyecciones): Vacio {
  if (r.sucursales.some((s) => s.calculada)) return { tipo: 'con-datos' };
  return {
    tipo: 'sin-datos',
    porque:
      r.sucursales.length === 1
        ? `${r.sucursales[0].sucursal} todavía no ha mandado pólizas de inventario.`
        : 'Ninguna sucursal ha mandado todavía pólizas de inventario.',
    falta:
      'La proyección sale de lo que salió de cada almacén (consumo, merma y traspasos) en las ' +
      'últimas 4 semanas. Las pólizas las manda el agente cuando tenga el lector de inventario de ' +
      'SoftRestaurant (F2-241).',
  };
}

/** "16/09/2026 → 22/09/2026" (días locales de la sucursal). */
export function textoRango(desde: string, hasta: string): string {
  return `${fechaParaTabla(desde)} → ${fechaParaTabla(hasta)}`;
}

/**
 * La orden de compra en CSV: sólo los artículos con sugerido mayor que 0. Los textos que vienen
 * de SR van por `texto()` (inyección de fórmulas); las cantidades son nuestras, a 3 decimales.
 */
export function ordenDeCompraCsv(r: Proyecciones, filas: readonly FilaProyeccion[]): string {
  const encabezados = [
    'Sucursal',
    'Almacén',
    'Clave',
    'Insumo',
    'Unidad',
    'Cantidad sugerida',
    'Existencia',
    'Mínimo',
    'Proyección',
    'Horizonte (días)',
    'Desde',
    'Hasta',
  ];
  const desde = new Map(r.sucursales.map((s) => [s.sucursalId, s]));
  const renglones = filas.filter(conSugerido).map((f) => {
    const s = desde.get(f.sucursalId);
    return [
      texto(f.sucursal),
      texto(nombreAlmacen(f)),
      texto(f.clave ?? f.insumoOrigenSrId),
      texto(nombreInsumo(f)),
      texto(f.unidad),
      campo(f.sugerido!),
      campo(f.existencia ?? ''),
      campo(f.minimo ?? ''),
      campo(f.proyeccion ?? ''),
      String(r.horizonte),
      s?.horizonteDesde ?? '',
      s?.horizonteHasta ?? '',
    ];
  });
  return armarCsv(encabezados, renglones);
}
