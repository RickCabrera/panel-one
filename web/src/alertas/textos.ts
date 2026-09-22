import type { Alerta, MotivoCierreAlerta, SeveridadAlerta, TipoAlerta } from '../api/tipos';
import { aCentavos, formatearPesos } from '../dinero/dinero';
import { edadLegible } from '../paginas/inicio/ventaEnVivo';
import { cantidad } from '../paginas/tickets/formato';

/** Textos del centro de alertas (F2-224). Todo estado se dice con palabras, no sólo con color. */

export const NOMBRE_TIPO: Record<TipoAlerta, string> = {
  sucursal_sin_reporte: 'Sucursal sin reportar',
  mesa_abierta: 'Mesa abierta mucho tiempo',
  cuenta_sin_imprimir: 'Cuenta sin imprimir',
  caida_venta: 'Caída de venta',
  bajo_minimo: 'Artículo bajo mínimo',
};

export const NOMBRE_SEVERIDAD: Record<SeveridadAlerta, string> = {
  critica: 'Crítica',
  advertencia: 'Advertencia',
};

export const NOMBRE_MOTIVO: Record<MotivoCierreAlerta, string> = {
  condicion: 'Se resolvió',
  regla_apagada: 'Regla apagada',
  sucursal_inactiva: 'Sucursal dada de baja',
  empresa_inactiva: 'Empresa dada de baja',
};

/** Qué mide cada regla, con su umbral, para la administración y el detalle. */
export function textoRegla(tipo: TipoAlerta, umbral: number): string {
  switch (tipo) {
    case 'sucursal_sin_reporte':
      return `Una sucursal lleva más de ${umbral} min sin reportar (o nunca ha reportado).`;
    case 'mesa_abierta':
      return `Una cuenta lleva abierta más de ${umbral} min.`;
    case 'cuenta_sin_imprimir':
      return `Una cuenta sin imprimir lleva abierta más de ${umbral} min.`;
    case 'caida_venta':
      return `La venta de hoy va más de ${umbral} % abajo del mismo día de la semana pasada a la misma hora (con al menos 5 cuentas en esa base).`;
    case 'bajo_minimo':
      return `Un artículo tiene en su almacén menos del ${umbral} % de su mínimo (el mínimo se define en Existencias).`;
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const entero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

function pesos(v: unknown): string {
  const c = typeof v === 'string' ? aCentavos(v) : null;
  return c === null ? 'sin dato' : formatearPesos(c);
}

/**
 * La alerta en una frase, a partir de su `detalle`. Lectura defensiva: un campo que falta
 * dice "sin dato", nunca un número inventado.
 */
export function describirAlerta(a: Alerta): string {
  const d = a.detalle ?? {};
  switch (a.tipo) {
    case 'sucursal_sin_reporte': {
      if (d.nunca === true) return `${a.sucursal}: nunca ha reportado.`;
      const edad = entero(d.edadSegundos);
      return `${a.sucursal}: sin reportar${edad === null ? '' : ` (última lectura ${edadLegible(edad)} al abrir)`}.`;
    }
    case 'mesa_abierta':
    case 'cuenta_sin_imprimir': {
      const mesa = texto(d.mesa);
      const folio = texto(d.folio) ?? a.llave;
      const minutos = entero(d.minutos);
      const que = a.tipo === 'mesa_abierta' ? 'abierta' : 'abierta sin imprimir';
      return `${mesa ? `Mesa ${mesa}` : 'Cuenta sin mesa'} (folio ${folio}, ${a.sucursal}): ${que} ${minutos === null ? 'más del umbral' : `${minutos} min`} al abrir la alerta.`;
    }
    case 'caida_venta': {
      const pct = texto(d.caidaPct);
      return `${a.sucursal}: venta de hoy ${pesos(d.ventaHoy)} contra ${pesos(d.ventaBase)} el mismo día de la semana pasada a la misma hora${pct ? ` (−${pct} %)` : ''}.`;
    }
    case 'bajo_minimo': {
      const articulo = texto(d.nombre) ?? texto(d.insumo) ?? 'Artículo sin dato';
      const almacen = texto(d.almacen);
      const cant = texto(d.cantidad);
      const min = texto(d.minimo);
      return `${articulo} (${almacen ? `almacén ${almacen}, ` : ''}${a.sucursal}): ${cant === null ? 'existencia sin dato' : `existencia ${cantidad(cant)}`} contra un mínimo de ${min === null ? 'sin dato' : cantidad(min)} al abrir la alerta.`;
    }
  }
}

/** "12 min", "3 h 5 min": cuánto duró (o lleva) la alerta. */
export function duracion(desde: string, hasta: number): string {
  const min = Math.max(0, Math.floor((hasta - Date.parse(desde)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 48) return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
  return `${Math.floor(h / 24)} días`;
}
