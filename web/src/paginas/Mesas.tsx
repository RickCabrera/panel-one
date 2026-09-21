import { ErrorApi } from '../api/cliente';
import { useAlcance } from '../filtros/alcance';
import { horaEn, zonaDelPanel } from '../filtros/periodo';
import type { Filtro } from './inicio/consultas';
import { Esqueleto } from './inicio/Tarjeta';
import { useAhora, useMonitorMesas } from './mesas/consultas';
import { Avisos, GridMesas, TarjetasKpi } from './mesas/Monitor';
import { armarMonitor } from './mesas/reglas';
import { Vista } from './Vista';

/**
 * Monitor de mesas en vivo (F1-050): el último snapshot de cada sucursal, consultado
 * cada 20 s. Una sucursal cuya última lectura pasó el umbral (reglas.ts) NO pinta sus
 * mesas: sale un aviso de desconectada en su lugar, nunca datos viejos como vivos.
 * El filtro por sucursal es el del topbar (F1-040).
 */
export function Mesas() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const zona = zonaDelPanel(sucursal, sucursales.data);
  const ahora = useAhora();

  // Sólo con el alcance validado, igual que el Panel (F1-041).
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const consulta = useMonitorMesas(filtro);

  return (
    <Vista titulo="Monitor de Mesas">
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-sm text-slate-500">
        <span data-testid="consultado" className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              consulta.isFetching ? 'animate-pulse bg-sky-500' : 'bg-slate-300'
            }`}
          />
          {consulta.isFetching
            ? 'Actualizando…'
            : consulta.dataUpdatedAt > 0
              ? `Consultado ${horaEn(zona, consulta.dataUpdatedAt)} · cada 20 s`
              : 'Sin consultar todavía'}
        </span>
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          disabled={filtro === null || consulta.isFetching}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Refrescar
        </button>
      </div>

      <Contenido consulta={consulta} ahora={ahora} zona={zona} varias={!sucursal} />
    </Vista>
  );
}

function Contenido({
  consulta,
  ahora,
  zona,
  varias,
}: {
  consulta: ReturnType<typeof useMonitorMesas>;
  ahora: number;
  zona: string;
  varias: boolean;
}) {
  if (consulta.data === undefined) {
    if (consulta.isError) {
      const detalle = consulta.error instanceof ErrorApi ? consulta.error.message : '';
      return (
        <p role="alert" className="mt-6 text-center text-sm text-red-700">
          No se pudieron cargar las mesas. {detalle}
        </p>
      );
    }
    return (
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Esqueleto key={i} />
        ))}
      </div>
    );
  }

  const monitor = armarMonitor(consulta.data, consulta.dataUpdatedAt, ahora);
  const conectadas = monitor.sucursales.filter((s) => s.estado === 'conectada').length;

  return (
    <>
      {consulta.isError && (
        <p role="status" data-testid="sin-actualizar" className="mt-2 text-sm text-amber-700">
          No se pudo actualizar; se muestra la última respuesta con su edad real.
        </p>
      )}
      <Avisos sucursales={monitor.sucursales} zona={zona} />
      {conectadas === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-500">
          {monitor.sucursales.length === 0
            ? 'No hay sucursales en este alcance.'
            : 'No hay datos en vivo que mostrar.'}
        </p>
      ) : (
        <>
          <div className="mt-4">
            <TarjetasKpi kpis={monitor.kpis} zona={zona} />
          </div>
          <div className="mt-6">
            <GridMesas mesas={monitor.mesas} conSucursal={varias} />
          </div>
        </>
      )}
    </>
  );
}
