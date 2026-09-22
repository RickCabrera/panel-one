import { Link, useSearchParams } from 'react-router';

import { useAlcance, useNormalizarAlcance } from '../filtros/alcance';
import { horaEn, zonaDelPanel } from '../filtros/periodo';
import type { Filtro } from './inicio/consultas';
import { useMonitorMesas } from './mesas/consultas';
import { Avisos, GridMesas, KpisPared } from './mesas/Monitor';
import { TEXTO_ESTADO, TEXTO_ORDEN } from './mesas/orden';
import {
  enlaceMesas,
  pedirPantallaCompleta,
  salirPantallaCompleta,
  TEXTO_NADIE_EN_VIVO,
} from './mesas/pared';
import { useCriterioMesas, useMonitorVivo } from './mesas/vivo';

/**
 * Vista de pared del Monitor de mesas (F2-223): para una pantalla colgada en la cocina o
 * la oficina. Sin menú ni cabecera (vive fuera de `Layout`), tipografía grande y nada que
 * operar: sin detalle de consumo. Alcance, orden y filtro llegan en la URL, igual que en
 * `/mesas`; la sesión y la marca de modo demo siguen como en todo el panel.
 *
 * "Se lee a dos metros" es un criterio tipográfico, no verificado a ojo en una pantalla:
 * todo el texto hereda `text-2xl` (24 px) y lo principal va en `text-4xl`/`text-5xl`.
 */
export function MesasPared() {
  // Fuera de `Layout`, nadie más corrige una URL sin empresa o con una sucursal ajena.
  useNormalizarAlcance();
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const zona = zonaDelPanel(sucursal, sucursales.data);
  const [parametros] = useSearchParams();
  const { criterio } = useCriterioMesas();

  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const consulta = useMonitorMesas(filtro);
  const monitor = useMonitorVivo(consulta.data, consulta.dataUpdatedAt);

  return (
    <div
      data-testid="vista-pared"
      className="min-h-screen bg-fondo p-4 text-2xl text-tinta sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-4xl font-bold">
            Mesas · {sucursal?.nombre ?? (empresa ? 'Todas las sucursales' : '')}
          </h1>
          <p className="text-tinta-suave">
            {consulta.dataUpdatedAt > 0
              ? `Consultado ${horaEn(zona, consulta.dataUpdatedAt)}`
              : 'Sin consultar todavía'}
            {' · '}
            {TEXTO_ORDEN[criterio.orden]} · {TEXTO_ESTADO[criterio.estado]}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={pedirPantallaCompleta}
            className="rounded-md border border-linea-fuerte bg-superficie px-4 py-2 hover:bg-realce"
          >
            Pantalla completa
          </button>
          <Link
            to={enlaceMesas('/mesas', parametros, criterio)}
            onClick={salirPantallaCompleta}
            className="rounded-md border border-linea-fuerte bg-superficie px-4 py-2 hover:bg-realce"
          >
            Salir
          </Link>
        </div>
      </header>

      {consulta.data === undefined || monitor === null ? (
        consulta.isError ? (
          <p role="alert" className="mt-8 text-center text-peligro">
            No se pudieron cargar las mesas.
          </p>
        ) : (
          <p aria-busy="true" className="mt-8 text-center text-tinta-tenue">
            Cargando mesas…
          </p>
        )
      ) : (
        <>
          {consulta.isError && (
            <p role="status" data-testid="sin-actualizar" className="mt-4 text-aviso">
              No se pudo actualizar; se muestra la última respuesta con su edad real.
            </p>
          )}
          <Avisos
            respuesta={{ filas: consulta.data, respuestaAt: consulta.dataUpdatedAt }}
            zona={zona}
            variante="pared"
          />
          {monitor.conectadas === 0 ? (
            <p data-testid="sin-vivo" className="mt-8 text-center text-tinta-tenue">
              {monitor.estados.length === 0
                ? 'No hay sucursales en este alcance.'
                : TEXTO_NADIE_EN_VIVO}
            </p>
          ) : (
            <>
              <div className="mt-6">
                <KpisPared monitor={monitor} />
              </div>
              <div className="mt-6">
                <GridMesas
                  mesas={monitor.mesas}
                  orden={criterio.orden}
                  estado={criterio.estado}
                  conSucursal={!sucursal}
                  sinHora={monitor.sinHora}
                  variante="pared"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
