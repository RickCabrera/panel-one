import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useAlcance } from '../filtros/alcance';
import {
  escribirPeriodo,
  horaEn,
  hoyEn,
  incluyeHoy,
  leerPeriodo,
  rangoDe,
  zonaDelPanel,
  type Periodo,
} from '../filtros/periodo';
import { useMesasAbiertas, useVentas, type Filtro } from './inicio/consultas';
import { SelectorPeriodo } from './inicio/SelectorPeriodo';
import {
  TarjetaDescuentos,
  TarjetaFormasPago,
  TarjetaTicketPromedio,
  TarjetaVentaEnVivo,
  TarjetaVentaTotal,
} from './inicio/Tarjetas';
import { Vista } from './Vista';

/**
 * El día local de hoy en `zona`, revisado cada minuto: con el panel abierto toda la
 * noche, "Hoy" pasa al día nuevo a la medianoche de la sucursal sin recargar.
 */
function useHoy(zona: string): string {
  const [, setPulso] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulso((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return hoyEn(zona, new Date());
}

export function Inicio() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const [parametros, setParametros] = useSearchParams();
  const periodo = leerPeriodo(parametros);

  const zona = zonaDelPanel(sucursal, sucursales.data);
  const hoy = useHoy(zona);
  const rango = rangoDe(periodo, hoy);
  const autoRefresco = rango !== null && incluyeHoy(rango, hoy);

  // Sólo con el alcance validado: la empresa está en tu lista y, si la URL trae
  // sucursal, también está en la lista de esa empresa. Y con la lista de sucursales
  // ya resuelta, porque de ella sale la zona de "hoy": consultar antes sería pedir
  // un día y enseguida otro.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;

  const resumen = useVentas('resumen', filtro, rango, autoRefresco);
  const porHora = useVentas('por-hora', filtro, rango, autoRefresco);
  const formas = useVentas('formas-pago', filtro, rango, autoRefresco);
  const mesas = useMesasAbiertas(filtro);
  const consultas = [resumen, porHora, formas, mesas];

  const cambiarPeriodo = useCallback(
    (nuevo: Periodo) => setParametros((previos) => escribirPeriodo(previos, nuevo)),
    [setParametros],
  );

  // "Actualizado" = el dato MÁS VIEJO en pantalla: si una tarjeta no se pudo
  // refrescar, la hora no promete que todo es de hace un momento.
  const exitosas = consultas.filter((c) => c.isSuccess).map((c) => c.dataUpdatedAt);
  const actualizado = exitosas.length > 0 ? Math.min(...exitosas) : null;
  const refrescando = consultas.some((c) => c.isFetching);

  const refrescar = () => {
    for (const consulta of consultas) void consulta.refetch();
  };

  return (
    <Vista titulo="Panel de ventas">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span data-testid="actualizado">
            {actualizado === null
              ? 'Sin datos todavía'
              : `Actualizado ${horaEn(zona, actualizado)}`}
          </span>
          <button
            type="button"
            onClick={refrescar}
            disabled={filtro === null || rango === null || refrescando}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {refrescando ? 'Actualizando…' : 'Refrescar'}
          </button>
        </div>
      </div>

      {rango === null ? (
        <p className="mt-6 text-sm text-slate-500">
          Corrige el rango de fechas para ver los datos.
        </p>
      ) : (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
          <TarjetaVentaTotal resumen={resumen} porHora={porHora} rango={rango} />
          <TarjetaFormasPago consulta={formas} />
          <TarjetaVentaEnVivo consulta={mesas} />
          <TarjetaTicketPromedio consulta={resumen} />
          <TarjetaDescuentos consulta={resumen} />
        </div>
      )}
    </Vista>
  );
}
