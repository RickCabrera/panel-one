import type {
  CanalNegocio,
  FilaMapeoArea,
  FilaVentaArea,
  MapeoAreas,
  MontoArea,
  VentaPorArea,
} from '../../api/tipos';
import { aCentavos, porcentaje, sumar } from '../../dinero/dinero';

/**
 * Áreas y canales (F2-233), reglas puras de la vista. La API ya manda las cifras cuadradas
 * (Σ canales + sin canal + sin clasificar = venta); aquí sólo se nombran, se calcula la
 * participación sobre la venta del periodo (en centavos, sin float) y se decide qué estado
 * vacío decir.
 */

export const CANALES: readonly CanalNegocio[] = ['comedor', 'mostrador', 'domicilio', 'plataformas'];

export const NOMBRE_CANAL: Record<CanalNegocio, string> = {
  comedor: 'Comedor',
  mostrador: 'Mostrador',
  domicilio: 'Domicilio',
  plataformas: 'Plataformas',
};

export const SIN_CANAL = 'Área sin canal asignado';
export const SIN_CLASIFICAR = 'Sin clasificar (la cuenta no trae área)';

/** Una fila de la tabla por canal: cada canal con cuentas y, si los hay, los dos renglones aparte. */
export interface FilaCanal {
  llave: CanalNegocio | 'sin-canal' | 'sin-area';
  nombre: string;
  venta: string;
  cuentas: number;
  participacion: string | null;
}

function participacionDe(venta: string, total: string): string | null {
  const parte = aCentavos(venta);
  const todo = aCentavos(total);
  return parte === null || todo === null ? null : porcentaje(parte, todo);
}

export function filasCanal(r: VentaPorArea): FilaCanal[] {
  const fila = (llave: FilaCanal['llave'], nombre: string, m: MontoArea): FilaCanal => ({
    llave,
    nombre,
    venta: m.venta,
    cuentas: m.cuentas,
    participacion: participacionDe(m.venta, r.venta),
  });
  return [
    ...r.canales.map((c) => fila(c.canal, NOMBRE_CANAL[c.canal], c)),
    ...(r.sinCanal.cuentas > 0 ? [fila('sin-canal', SIN_CANAL, r.sinCanal)] : []),
    ...(r.sinArea.cuentas > 0 ? [fila('sin-area', SIN_CLASIFICAR, r.sinArea)] : []),
  ];
}

/** La participación de un área sobre la venta del periodo. */
export function participacionArea(f: FilaVentaArea, r: VentaPorArea): string | null {
  return participacionDe(f.venta, r.venta);
}

/**
 * Σ de lo que pinta la tabla por canal, en centavos (null si algún importe es ilegible). Tiene
 * que ser la venta del periodo: el test de la vista lo compara con la de Inicio.
 */
export function sumaCanales(r: VentaPorArea): bigint | null {
  const centavos = [...r.canales, r.sinCanal, r.sinArea].map((m) => aCentavos(m.venta));
  return centavos.some((c) => c === null) ? null : sumar(centavos as bigint[]);
}

export function nombreArea(f: FilaVentaArea): string {
  return f.nombre ?? `Área ${f.areaOrigenSrId} del POS`;
}

/** El estado del área en palabras (nunca "activo" a secas). */
export function estadoArea(f: FilaVentaArea): string {
  switch (f.cruce) {
    case 'catalogo':
      return f.activo === false ? 'Ya no está en el POS' : 'En el catálogo';
    case 'sin-catalogo':
      return 'No está en el catálogo del POS';
    case 'sin-sincronizar':
      return 'Sucursal sin catálogo de áreas';
  }
}

export function canalTexto(canal: CanalNegocio | null): string {
  return canal === null ? 'Sin asignar' : NOMBRE_CANAL[canal];
}

/**
 * Por qué no hay nada que desglosar, dicho con todas sus letras (regla de Ronda 2). `null` =
 * hay un desglose real que pintar.
 */
export function motivoVacio(r: VentaPorArea): string | null {
  if (r.cuentas === 0) {
    return 'No hubo cuentas cerradas en el periodo. Elige otro periodo o sucursal; si esperabas ventas, revisa que el agente de la sucursal esté conectado.';
  }
  if (r.sinArea.cuentas === r.cuentas) {
    return 'Ninguna cuenta del periodo trae el área donde se atendió, así que no se puede repartir por área ni por canal (se muestra entera como "sin clasificar"). Hace falta que el agente de la sucursal mande el área de cada cuenta; hoy el lector de cuentas de SoftRestaurant todavía no la lee.';
  }
  return null;
}

/** Sucursales del alcance que nunca cerraron su catálogo de áreas. */
export function sinCatalogo(r: VentaPorArea): string[] {
  return r.catalogo.filter((c) => !c.sincronizado).map((c) => c.sucursal);
}

/** Las áreas del mapeo agrupadas por sucursal, en el orden en que llegaron. */
export function mapeoPorSucursal(m: MapeoAreas): Array<{
  sucursalId: string;
  sucursal: string;
  ultimaCompletaAt: string | null;
  areas: FilaMapeoArea[];
}> {
  return m.sucursales.map((s) => ({
    ...s,
    areas: m.areas.filter((a) => a.sucursalId === s.sucursalId),
  }));
}
