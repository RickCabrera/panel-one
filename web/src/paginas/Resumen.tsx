import { useSearchParams } from 'react-router';

import { useMinuto } from '../consultas/useMinuto';
import { useAlcance } from '../filtros/alcance';
import { incluyeHoy, TIPOS_PERIODO } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista } from '../filtros/vista';
import { useMesasAbiertas, useVentas, type Filtro } from './inicio/consultas';
import { TarjetaVentaEnVivo } from './inicio/Tarjetas';
import { useReporte } from './reportes/consultas';
import {
  TarjetaAlertas,
  TarjetaSucursales,
  TarjetaTicketComensales,
  TarjetaTop5,
  TarjetaVentaComparada,
} from './resumen/Bloques';
import { comparableDelDia, comparableDelMes, periodoComparable } from './resumen/comparables';
import { Vista } from './Vista';

/** Cuántos productos muestra el top y en cuántos se busca su importe previo. */
const TOP = 5;
const TOP_BASE = 50;

/**
 * Resumen ejecutivo (F2-220): lo que un dueño quiere ver en veinte segundos. No calcula nada
 * propio: cada cifra es la MISMA consulta (misma llave, misma caché) que la pinta en Inicio o
 * en Reportes, y su base es la misma consulta con otro rango y, si toca, `alturaAl`.
 *
 * - "Hoy" y "Este mes" no dependen del periodo de la cabecera: son la foto de siempre.
 * - Ticket promedio, comensales, sucursales y top 5 son del periodo de la cabecera, contra
 *   el periodo comparable (`periodoComparable`).
 */
export function Resumen() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const { periodo, rango, hoy } = usePeriodo();
  const [parametros] = useSearchParams();
  const ahora = useMinuto();

  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;

  // Hoy: el mismo `useVentas('resumen', …, hoy..hoy)` que "Venta total" de Inicio con "Hoy".
  const dia = comparableDelDia(hoy, ahora);
  const ventaHoy = useVentas('resumen', filtro, { desde: hoy, hasta: hoy }, true);
  const baseHoy = useVentas('resumen', filtro, dia.rango, true, dia.alturaAl);

  // Este mes: el mismo que Inicio con "Este mes".
  const mes = comparableDelMes(hoy, ahora);
  const ventaMes = useVentas('resumen', filtro, mes.actual, true);
  const baseMes = useVentas('resumen', filtro, mes.base.rango, true, mes.base.alturaAl);

  const mesas = useMesasAbiertas(filtro);

  // Del periodo de la cabecera.
  const autoRefresco = rango !== null && incluyeHoy(rango, hoy);
  const comparable = rango === null ? null : periodoComparable(periodo.tipo, rango, hoy, ahora);
  const rangoBase = comparable?.rango ?? null;
  const resumen = useVentas('resumen', filtro, rango, autoRefresco);
  const resumenBase = useVentas('resumen', filtro, rangoBase, autoRefresco, comparable?.alturaAl);
  const sucursalesPeriodo = useReporte(
    'comparativo-sucursales',
    filtro,
    rango,
    {},
    undefined,
    autoRefresco,
  );
  const sucursalesBase = useReporte(
    'comparativo-sucursales',
    filtro,
    rangoBase,
    {},
    comparable?.alturaAl,
  );
  const top = useReporte(
    'top-productos',
    filtro,
    rango,
    { por: 'importe', limite: TOP },
    undefined,
    autoRefresco,
  );
  const topBase = useReporte(
    'top-productos',
    filtro,
    rangoBase,
    { por: 'importe', limite: TOP_BASE },
    comparable?.alturaAl,
  );

  const nombrePeriodo = TIPOS_PERIODO.find((t) => t.tipo === periodo.tipo)?.nombre ?? '';

  return (
    <Vista titulo="Resumen">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <TarjetaVentaComparada
          titulo="Hoy"
          testId="resumen-venta-hoy"
          actual={ventaHoy}
          base={baseHoy}
          comparable={dia}
          mesas={mesas}
        />
        <TarjetaVentaEnVivo consulta={mesas} />
        <TarjetaVentaComparada
          titulo="Este mes"
          testId="resumen-venta-mes"
          actual={ventaMes}
          base={baseMes}
          comparable={mes.base}
        />
      </div>

      <h2 className="mt-6 text-sm font-medium text-tinta-suave" data-testid="resumen-periodo">
        {rango === null || comparable === null
          ? `Periodo: ${nombrePeriodo}`
          : `Periodo: ${nombrePeriodo} (${rango.desde} a ${rango.hasta}), comparado con ${comparable.etiqueta}`}
      </h2>
      {rango === null || comparable === null ? (
        <p className="mt-2 text-sm text-tinta-tenue">
          Corrige el rango de fechas para ver las cifras del periodo.
        </p>
      ) : (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
          <TarjetaTicketComensales actual={resumen} base={resumenBase} comparable={comparable} />
          <TarjetaSucursales
            actual={sucursalesPeriodo}
            base={sucursalesBase}
            comparable={comparable}
            sucursalElegida={sucursal !== undefined}
          />
          <TarjetaTop5
            actual={top}
            base={topBase}
            resumenBase={resumenBase}
            comparable={comparable}
          />
        </div>
      )}

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <TarjetaAlertas mesas={mesas} enlaceMonitor={`/mesas${queryVista(parametros)}`} />
      </div>
    </Vista>
  );
}
