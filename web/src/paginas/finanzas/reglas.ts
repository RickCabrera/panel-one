import type {
  CompraResumen,
  Compras,
  CostoVendido,
  EstadoResultados,
  EstadoResultadosBase,
  EstadoResultadosSucursal,
  Gasto,
  MotivoSinCalculo,
} from '../../api/tipos';
import { armarCsv, importeCsv, texto, textoExcel } from '../../csv/csv';
import { aCentavos, formatearPesos, paraGrafica } from '../../dinero/dinero';

/**
 * Reglas PURAS de Compras y de Gastos y utilidad (F2-126): textos, avisos, estados vacíos, datos
 * de la gráfica, CSV y validación del formulario de gastos. Ningún importe pasa por `number`
 * salvo la altura de una barra (`paraGrafica`). Lo que el API no puede afirmar (costo o utilidad
 * nulos) se dice con su porqué, nunca se pinta $0.00.
 */

export const TEXTO_MOTIVO: Record<MotivoSinCalculo, string> = {
  sin_catalogo_productos:
    'su catálogo de productos nunca se ha sincronizado completo: lo vendido no se puede cruzar ' +
    'con recetas',
  sin_recetas: 'todavía no ha mandado recetas (llegan con el lector de recetas, F2-241)',
};

/** Por qué no hay costo ni utilidad para una sucursal (o nulo si sí los hay). */
export function motivoSinUtilidad(s: EstadoResultadosSucursal): string | null {
  if (s.costo.importe !== null) return null;
  return `${s.sucursal}: sin costo de lo vendido, ${TEXTO_MOTIVO[s.motivo ?? 'sin_recetas']}.`;
}

/** Qué le falta al costo para estar completo, en una línea; nulo si está completo. */
export function faltaDelCosto(c: CostoVendido): string | null {
  if (c.completo || c.importe === null) return null;
  const partes: string[] = [];
  if (c.insumosSinCosto > 0) {
    partes.push(
      `${c.insumosSinCosto} ${c.insumosSinCosto === 1 ? 'insumo' : 'insumos'} sin costo de referencia`,
    );
  }
  if (c.productosSinCosto > 0) {
    partes.push(
      `${c.productosSinCosto} ${c.productosSinCosto === 1 ? 'producto vendido' : 'productos vendidos'} ` +
        `sin receta (${formatearPesosTexto(c.ventaSinCosto)} en partidas, con IVA y antes de descuento)`,
    );
  }
  // Incompleto sin contadores (no debería pasar): se dice igual, nunca se calla.
  return partes.length > 0 ? partes.join(' · ') : 'algo de lo vendido (sin detalle)';
}

function formatearPesosTexto(t: string): string {
  const c = aCentavos(t);
  return c === null ? 'importe ilegible' : formatearPesos(c);
}

/** Los avisos del estado de resultados, en orden: lo que no se calcula, lo sobrestimado, lo vacío. */
export function avisosEstado(e: EstadoResultados): string[] {
  const avisos: string[] = [];
  for (const s of e.sucursales) {
    const m = motivoSinUtilidad(s);
    if (m) avisos.push(m);
  }
  for (const s of e.sucursales) {
    // Manda la bandera del API; `faltaDelCosto` sólo pone el detalle.
    const falta = faltaDelCosto(s.costo);
    if (s.utilidadSobrestimada || falta) {
      avisos.push(
        `${s.sucursal}: utilidad SOBRESTIMADA (la real es menor) porque falta costo de ${falta ?? 'algo de lo vendido (sin detalle)'}.`,
      );
    }
    if (s.sinVentas && (aCentavos(s.gastos) ?? 0n) !== 0n) {
      avisos.push(
        `${s.sucursal}: sin ventas registradas en el periodo; su utilidad es sólo −gastos. Si la ` +
          'sucursal no reportó, esa cifra no es real.',
      );
    }
  }
  if (e.total.sucursalesSinCalculo.length > 0) {
    avisos.push(
      `El total no tiene costo ni utilidad: falta el costo de ${e.total.sucursalesSinCalculo.join(', ')}.`,
    );
  }
  return avisos;
}

/** El estado completo está vacío si no hubo cuentas ni gastos en ninguna sucursal. */
export function estadoVacio(e: EstadoResultados): boolean {
  return e.total.cuentas === 0 && (aCentavos(e.total.gastos) ?? 0n) === 0n;
}

/** Un importe que puede ser nulo: "—" con el porqué lo decide la vista. */
export function dineroONulo(v: string | null): string {
  if (v === null) return '—';
  return formatearPesosTexto(v);
}

/** "72.4 %", "−3.0 %"; nulo = "—". */
export function textoMargen(m: string | null): string {
  if (m === null) return '—';
  return m.startsWith('-') ? `−${m.slice(1)} %` : `${m} %`;
}

// ---------------------------------------------------------------------------
// Gráfica
// ---------------------------------------------------------------------------

export interface BarraEstado {
  etiqueta: string;
  ventaNeta: number;
  costo: number | null;
  gastos: number;
  utilidad: number | null;
}

const alto = (v: string | null): number | null => {
  if (v === null) return null;
  const c = aCentavos(v);
  return c === null ? null : paraGrafica(c);
};

/** Una barra por sucursal: venta neta, costo, gastos y utilidad de operación (null = sin barra). */
export function barrasEstado(e: EstadoResultados): BarraEstado[] {
  return e.sucursales.map((s) => ({
    etiqueta: s.sucursal,
    ventaNeta: alto(s.ventaNeta) ?? 0,
    costo: alto(s.costo.importe),
    gastos: alto(s.gastos) ?? 0,
    utilidad: alto(s.utilidadOperacion),
  }));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const invalido = (que: string, v: string) => () => `${que} trae un importe inválido ("${v}").`;
const dineroCsv = (v: string | null, que: string) =>
  v === null ? '' : importeCsv(v, invalido(que, v));

export const ENCABEZADOS_ESTADO: readonly string[] = [
  'Sucursal',
  'Cuentas',
  'Venta con IVA',
  'Venta neta sin IVA',
  'Costo de lo vendido',
  'Costo completo',
  'Utilidad bruta',
  'Margen bruto %',
  'Gastos',
  'Utilidad de operación',
  'Margen de operación %',
  'Utilidad sobrestimada',
  'Compras (informativo)',
  'Por qué sin costo',
];

function filaEstado(nombre: string, r: EstadoResultadosBase, motivo: string): string[] {
  return [
    texto(nombre),
    String(r.cuentas),
    dineroCsv(r.venta, nombre),
    dineroCsv(r.ventaNeta, nombre),
    dineroCsv(r.costo.importe, nombre),
    r.costo.importe === null ? '' : r.costo.completo ? 'sí' : 'no',
    dineroCsv(r.utilidadBruta, nombre),
    r.margenBruto ?? '',
    dineroCsv(r.gastos, nombre),
    dineroCsv(r.utilidadOperacion, nombre),
    r.margenOperacion ?? '',
    r.utilidadOperacion === null ? '' : r.utilidadSobrestimada ? 'sí' : 'no',
    dineroCsv(r.compras, nombre),
    texto(motivo),
  ];
}

/** Una fila por sucursal y la del total (aquí sí: el total nulo es información que se pierde). */
export function estadoACsv(e: EstadoResultados): string {
  return armarCsv(ENCABEZADOS_ESTADO, [
    ...e.sucursales.map((s) =>
      filaEstado(s.sucursal, s, s.motivo === null ? '' : TEXTO_MOTIVO[s.motivo]),
    ),
    filaEstado(
      'Total',
      e.total,
      e.total.sucursalesSinCalculo.length > 0
        ? `falta el costo de ${e.total.sucursalesSinCalculo.join(', ')}`
        : '',
    ),
  ]);
}

export const ENCABEZADOS_GASTOS: readonly string[] = [
  'Día',
  'Sucursal',
  'Categoría',
  'Concepto',
  'Monto sin IVA',
  'Anulado',
];

export function gastosACsv(gastos: readonly Gasto[], sucursal: (id: string) => string): string {
  return armarCsv(
    ENCABEZADOS_GASTOS,
    gastos.map((g) => [
      g.dia,
      texto(sucursal(g.sucursalId)),
      texto(g.categoria),
      texto(g.concepto),
      importeCsv(g.monto, invalido(`El gasto ${g.concepto}`, g.monto)),
      g.anulado ? 'sí' : 'no',
    ]),
  );
}

export const ENCABEZADOS_COMPRAS: readonly string[] = [
  'Fecha',
  'Hora',
  'Sucursal',
  'Folio',
  'Proveedor',
  'Almacén',
  'Partidas',
  'Total sin IVA',
  'Cancelada',
];

export function comprasACsv(
  compras: readonly CompraResumen[],
  sucursal: (id: string) => string,
  fechaHora: (c: CompraResumen) => { fecha: string; hora: string } | null,
): string {
  return armarCsv(
    ENCABEZADOS_COMPRAS,
    compras.map((c) => {
      const fh = fechaHora(c);
      return [
        fh?.fecha ?? '',
        fh?.hora ?? '',
        texto(sucursal(c.sucursalId)),
        textoExcel(c.folio),
        texto(c.proveedor ?? c.proveedorOrigenSrId ?? ''),
        texto(c.almacen ?? c.almacenOrigenSrId ?? ''),
        String(c.partidas),
        importeCsv(c.total, invalido(`La compra ${c.folio}`, c.total)),
        c.cancelada ? 'sí' : 'no',
      ];
    }),
  );
}

// ---------------------------------------------------------------------------
// Compras: estado vacío
// ---------------------------------------------------------------------------

export type VacioCompras =
  { tipo: 'sin-lector'; texto: string } | { tipo: 'periodo'; texto: string } | null;

/** Por qué no hay compras que mostrar: el agente nunca las mandó, o el periodo no tiene. */
export function vacioCompras(c: Compras): VacioCompras {
  if (c.compras.length > 0) return null;
  if (c.sucursales.every((s) => s.comprasRecibidas === 0)) {
    return {
      tipo: 'sin-lector',
      texto:
        'Ninguna sucursal del alcance ha mandado compras todavía: las lee el agente de ' +
        'SoftRestaurant cuando tenga el lector de compras (F2-241). Esto no significa que no se ' +
        'haya comprado.',
    };
  }
  return {
    tipo: 'periodo',
    texto: 'Sin compras registradas en SoftRestaurant en este periodo: elige otro en la cabecera.',
  };
}

/** Sucursales que nunca mandaron compras, cuando otras sí (su ausencia no es "cero compras"). */
export function sucursalesSinCompras(c: Compras): string[] {
  if (c.sucursales.every((s) => s.comprasRecibidas === 0)) return [];
  return c.sucursales.filter((s) => s.comprasRecibidas === 0).map((s) => s.sucursal);
}

// ---------------------------------------------------------------------------
// Formulario de gastos
// ---------------------------------------------------------------------------

const MONTO = /^\d{1,10}(\.\d{1,2})?$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export interface FormGasto {
  sucursalId: string;
  categoriaId: string;
  dia: string;
  concepto: string;
  monto: string;
}

/** Errores del formulario, en español y por campo. El API valida lo mismo (y el "hoy" local). */
export function erroresGasto(f: FormGasto, hoy: string): string[] {
  const errores: string[] = [];
  if (!f.sucursalId) errores.push('Elige la sucursal.');
  if (!f.categoriaId) errores.push('Elige la categoría.');
  if (!DIA.test(f.dia)) errores.push('Elige el día del gasto.');
  else if (f.dia > hoy) errores.push('El día del gasto no puede ser posterior a hoy.');
  if (f.concepto.trim().length === 0) errores.push('Escribe el concepto.');
  else if (f.concepto.trim().length > 200) errores.push('El concepto va de 1 a 200 caracteres.');
  const monto = f.monto.trim();
  if (!MONTO.test(monto)) {
    errores.push('El monto es un importe positivo con hasta 2 decimales (sin $ ni comas).');
  } else if ((aCentavos(monto) ?? 0n) <= 0n) {
    errores.push('El monto tiene que ser mayor que cero.');
  }
  return errores;
}
