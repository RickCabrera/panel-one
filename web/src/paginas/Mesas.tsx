import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import { useAlcance } from '../filtros/alcance';
import { horaEn, zonaDelPanel } from '../filtros/periodo';
import { Esqueleto } from './inicio/Tarjeta';
import type { Filtro } from './inicio/consultas';
import { useMonitorMesas } from './mesas/consultas';
import { DetalleMesa } from './mesas/Detalle';
import { Avisos, GridMesas, TarjetasKpi, type AbrirDetalle } from './mesas/Monitor';
import {
  ESTADOS,
  ORDENES,
  TEXTO_ESTADO,
  TEXTO_ORDEN,
  leerOrden,
  type CriterioMesas,
} from './mesas/orden';
import { enlaceMesas, pedirPantallaCompleta, TEXTO_NADIE_EN_VIVO } from './mesas/pared';
import { buscarSeleccion, seleccionDe, type Seleccion } from './mesas/seleccion';
import { nombreMesa } from './mesas/textos';
import { useCriterioMesas, useMonitorVivo, type MonitorVivo } from './mesas/vivo';
import { Vista } from './Vista';

/**
 * Monitor de mesas en vivo (F1-050): el último snapshot de cada sucursal, consultado
 * cada 20 s. Una sucursal cuya última lectura pasó el umbral (reglas.ts) NO pinta sus
 * mesas: sale un aviso de desconectada en su lugar, nunca datos viejos como vivos.
 * El filtro por sucursal es el de la cabecera (F2-212). Clic en una mesa abre su detalle
 * de consumo (F1-051) con los datos de esta MISMA consulta: abrir o cerrar el modal no
 * pide nada al API ni desmonta el grid.
 *
 * F2-223: orden y filtro por estado (en la URL y recordados por usuario), KPI de
 * atención clicable, vista de pared (`MesasPared`), y el reloj fuera de la vista: el
 * tiempo de cada mesa avanza en su tarjeta sin volver a pintar lo demás (`mesas/vivo.ts`).
 */
export function Mesas() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const zona = zonaDelPanel(sucursal, sucursales.data);
  const [parametros] = useSearchParams();
  const { criterio, elegir } = useCriterioMesas();

  // Sólo con el alcance validado, igual que el Panel (F1-041).
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const consulta = useMonitorMesas(filtro);
  const monitor = useMonitorVivo(consulta.data, consulta.dataUpdatedAt);

  // La selección vale sólo en el alcance en que se hizo: al cambiar de empresa o
  // sucursal se descarta (reset en render, sin efecto).
  const alcance = `${empresa?.id ?? ''}|${sucursalId ?? ''}`;
  const [seleccion, setSeleccion] = useState<{ alcance: string; sel: Seleccion } | null>(null);
  if (seleccion !== null && seleccion.alcance !== alcance) setSeleccion(null);
  const abridor = useRef<HTMLButtonElement | null>(null);
  const contenido = useRef<HTMLDivElement>(null);

  // `abrir` es ESTABLE (las tarjetas memorizadas lo comparan): lee lo último por ref.
  const actual = useRef({ alcance, respuestaAt: consulta.dataUpdatedAt, varias: !sucursal });
  useEffect(() => {
    actual.current = { alcance, respuestaAt: consulta.dataUpdatedAt, varias: !sucursal };
  });
  const abrir = useCallback<AbrirDetalle>((mesa, boton) => {
    abridor.current = boton;
    const { alcance, respuestaAt, varias } = actual.current;
    setSeleccion({ alcance, sel: seleccionDe(mesa, respuestaAt, nombreMesa(mesa, varias)) });
  }, []);
  const cerrar = () => {
    setSeleccion(null);
    // El foco vuelve a la tarjeta que lo abrió; si ya no está, al contenido.
    const boton = abridor.current;
    abridor.current = null;
    if (boton?.isConnected) boton.focus();
    else contenido.current?.focus();
  };

  return (
    <Vista titulo="Monitor de Mesas">
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-sm text-tinta-tenue">
        <span data-testid="consultado" className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              consulta.isFetching ? 'animate-pulse bg-info' : 'bg-linea-fuerte'
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
          className="rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50"
        >
          Refrescar
        </button>
        <Link
          to={enlaceMesas('/mesas/pared', parametros, criterio)}
          onClick={pedirPantallaCompleta}
          className="rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce"
        >
          Vista de pared
        </Link>
      </div>

      <Controles criterio={criterio} elegir={elegir} />

      <div ref={contenido} tabIndex={-1} className="outline-none">
        <Contenido
          consulta={consulta}
          monitor={monitor}
          zona={zona}
          varias={!sucursal}
          criterio={criterio}
          onAtencion={() =>
            elegir({ estado: criterio.estado === 'atencion' ? 'todas' : 'atencion' })
          }
          seleccion={seleccion?.alcance === alcance ? seleccion.sel : null}
          onAbrir={abrir}
          onCerrar={cerrar}
        />
      </div>
    </Vista>
  );
}

/** Orden (select) y filtro por estado (botones con `aria-pressed`). */
function Controles({
  criterio,
  elegir,
}: {
  criterio: CriterioMesas;
  elegir: (cambio: Partial<CriterioMesas>) => void;
}) {
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2 text-tinta-medio">
        Ordenar por
        <select
          value={criterio.orden}
          onChange={(e) => {
            const orden = leerOrden(e.target.value);
            if (orden) elegir({ orden });
          }}
          className="rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-tinta"
        >
          {ORDENES.map((o) => (
            <option key={o} value={o}>
              {TEXTO_ORDEN[o]}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label="Filtrar mesas" className="flex flex-wrap gap-1">
        {ESTADOS.map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={criterio.estado === e}
            onClick={() => elegir({ estado: e })}
            className={`rounded-md border px-3 py-1 ${
              criterio.estado === e
                ? 'border-acento-borde bg-realce-fuerte font-medium text-tinta'
                : 'border-linea-fuerte bg-superficie text-tinta-medio hover:bg-realce'
            }`}
          >
            {TEXTO_ESTADO[e]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Contenido({
  consulta,
  monitor,
  zona,
  varias,
  criterio,
  onAtencion,
  seleccion,
  onAbrir,
  onCerrar,
}: {
  consulta: ReturnType<typeof useMonitorMesas>;
  monitor: MonitorVivo | null;
  zona: string;
  varias: boolean;
  criterio: CriterioMesas;
  onAtencion: () => void;
  seleccion: Seleccion | null;
  onAbrir: AbrirDetalle;
  onCerrar: () => void;
}) {
  if (consulta.data === undefined || monitor === null) {
    if (consulta.isError) {
      const detalle = consulta.error instanceof ErrorApi ? consulta.error.message : '';
      return (
        <p role="alert" className="mt-6 text-center text-sm text-peligro">
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

  const respuesta = { filas: consulta.data, respuestaAt: consulta.dataUpdatedAt };

  return (
    <>
      {consulta.isError && (
        <p role="status" data-testid="sin-actualizar" className="mt-2 text-sm text-aviso">
          No se pudo actualizar; se muestra la última respuesta con su edad real.
        </p>
      )}
      <Avisos respuesta={respuesta} zona={zona} />
      {monitor.conectadas === 0 ? (
        <p data-testid="sin-vivo" className="mt-6 text-center text-sm text-tinta-tenue">
          {monitor.estados.length === 0 ? 'No hay sucursales en este alcance.' : TEXTO_NADIE_EN_VIVO}
        </p>
      ) : (
        <>
          <div className="mt-4">
            <TarjetasKpi
              monitor={monitor}
              respuesta={respuesta}
              zona={zona}
              filtroAtencion={criterio.estado === 'atencion'}
              onAtencion={onAtencion}
            />
          </div>
          <div className="mt-6">
            <GridMesas
              mesas={monitor.mesas}
              orden={criterio.orden}
              estado={criterio.estado}
              conSucursal={varias}
              sinHora={monitor.sinHora}
              onAbrir={onAbrir}
            />
          </div>
        </>
      )}
      {/* Fuera del condicional del grid: si la sucursal se desconecta con el modal
          abierto, el modal lo dice en vez de desaparecer. */}
      {seleccion !== null && (
        <DetalleMesa
          mesa={buscarSeleccion(monitor.mesas, consulta.dataUpdatedAt, seleccion)}
          titulo={seleccion.titulo}
          conSucursal={varias}
          onCerrar={onCerrar}
        />
      )}
    </>
  );
}
