import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import { nombreCsv } from '../csv/csv';
import { useAlcance } from '../filtros/alcance';
import {
  escribirPeriodo,
  leerPeriodo,
  rangoDe,
  zonaDelPanel,
  type Periodo,
} from '../filtros/periodo';
import { useHoy } from '../filtros/useHoy';
import type { Filtro } from './inicio/consultas';
import { SelectorPeriodo } from './inicio/SelectorPeriodo';
import { useReporte, type LimiteTop, type OrdenTop } from './reportes/consultas';
import { comparativoACsv, porDiaACsv, topACsv } from './reportes/csv';
import { ReporteComparativo, ReportePorDia, ReporteTop } from './reportes/Tarjetas';
import { Vista } from './Vista';

/**
 * Reportes básicos (F1-043): ventas por día, comparativo entre sucursales y top
 * productos, con export CSV cada uno.
 *
 * Mismo periodo en la URL y mismo "hoy" en la zona de la sucursal que el Panel de
 * ventas (F1-041): para el mismo periodo, el total de "Ventas por día" y el del
 * comparativo son exactamente la Venta total del panel (lo garantiza la API y aquí
 * se suma en centavos exactos).
 */
export function Reportes() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const [parametros, setParametros] = useSearchParams();
  const periodo = leerPeriodo(parametros);

  const zona = zonaDelPanel(sucursal, sucursales.data);
  const hoy = useHoy(zona);
  const rango = rangoDe(periodo, hoy);

  // Sólo con el alcance validado y la lista de sucursales resuelta (de ella sale la
  // zona de "hoy"), igual que el Panel de ventas.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;

  const [por, setPor] = useState<OrdenTop>('importe');
  const [limite, setLimite] = useState<LimiteTop>(10);

  const porDia = useReporte('por-dia', filtro, rango);
  const comparativo = useReporte('comparativo-sucursales', filtro, rango);
  const top = useReporte('top-productos', filtro, rango, { por, limite });

  const cambiarPeriodo = useCallback(
    (nuevo: Periodo) => setParametros((previos) => escribirPeriodo(previos, nuevo)),
    [setParametros],
  );

  const archivo = (prefijo: string) =>
    rango ? nombreCsv(prefijo, rango.desde, rango.hasta, sucursal?.nombre) : `${prefijo}.csv`;

  return (
    <Vista titulo="Reportes">
      <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />

      {rango === null ? (
        <p className="mt-6 text-sm text-slate-500">
          Corrige el rango de fechas para ver los reportes.
        </p>
      ) : (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <ReportePorDia consulta={porDia} nombreCsv={archivo('ventas-por-dia')} csv={porDiaACsv} />
          <ReporteComparativo
            consulta={comparativo}
            nombreCsv={archivo('comparativo-sucursales')}
            csv={comparativoACsv}
          />
          <ReporteTop
            consulta={top}
            por={por}
            limite={limite}
            onCambiarPor={setPor}
            onCambiarLimite={setLimite}
            nombreCsv={archivo(`top-productos-por-${por}`)}
            csv={topACsv}
          />
        </div>
      )}
    </Vista>
  );
}
