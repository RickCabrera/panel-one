import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useAlertasAbiertas, useFiltroAlcance, useHistorialAlertas } from '../alertas/consultas';
import {
  describirAlerta,
  duracion,
  NOMBRE_MOTIVO,
  NOMBRE_SEVERIDAD,
  NOMBRE_TIPO,
} from '../alertas/textos';
import type { Alerta, Sucursal } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { useMinuto } from '../consultas/useMinuto';
import { useAlcance } from '../filtros/alcance';
import { queryVista } from '../filtros/vista';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { fechaHoraEn, fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

/** Presentación en la zona de la sucursal de la alerta; sin ella, la del panel (CDMX). */
const ZONA_POR_DEFECTO = 'America/Mexico_City';

function cuando(instante: string, zona: string): string {
  const { fecha, hora } = fechaHoraEn(zona, instante);
  return `${fechaParaTabla(fecha)} ${hora}`;
}

/** La pestaña "Alertas" de Administración, con el alcance de la vista. */
function busquedaAdmin(parametros: URLSearchParams): string {
  const q = new URLSearchParams(queryVista(parametros));
  q.set('tab', 'alertas');
  return `?${q.toString()}`;
}

const CLASE_SEVERIDAD: Record<Alerta['severidad'], string> = {
  critica: 'bg-peligro-fondo text-peligro',
  advertencia: 'bg-aviso-fondo text-aviso',
};

function Insignia({ alerta }: { alerta: Alerta }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${CLASE_SEVERIDAD[alerta.severidad]}`}
    >
      {NOMBRE_SEVERIDAD[alerta.severidad]}
    </span>
  );
}

/**
 * Centro de alertas (F2-224): las abiertas del alcance (la misma consulta que la campana) y
 * el historial paginado. Las alertas las abre y cierra el API solo; aquí nada se escribe.
 */
export function Alertas() {
  const filtro = useFiltroAlcance();
  const { sucursales } = useAlcance();
  const usuario = useUsuario();
  const [parametros] = useSearchParams();
  const ahora = useMinuto().getTime();
  const [pagina, setPagina] = useState(1);
  // Otro alcance, otra historia: vuelve a la primera página (patrón de "estado del render
  // anterior", sin efecto).
  const llaveAlcance = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}`;
  const [alcancePrevio, setAlcancePrevio] = useState(llaveAlcance);
  if (alcancePrevio !== llaveAlcance) {
    setAlcancePrevio(llaveAlcance);
    setPagina(1);
  }

  const abiertas = useAlertasAbiertas(filtro);
  const historial = useHistorialAlertas(filtro, pagina);

  const zonas = new Map<string, string>(
    (sucursales.data ?? []).map((s: Sucursal) => [s.id, s.zonaHoraria]),
  );
  const zonaDe = (a: Alerta) => zonas.get(a.sucursalId) ?? ZONA_POR_DEFECTO;
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);

  return (
    <Vista titulo="Alertas">
      <p className="mb-4 text-sm text-tinta-tenue">
        Las alertas se abren y se cierran solas: el sistema revisa cada minuto si la condición
        sigue. Una alerta resuelta queda en el historial con la hora en que abrió y la hora en que
        cerró.
        {esAdmin && (
          <>
            {' '}
            <Link
              to={{ pathname: '/admin', search: busquedaAdmin(parametros) }}
              className="text-acento-texto underline-offset-2 hover:underline"
            >
              Configurar umbrales
            </Link>
          </>
        )}
      </p>

      <Tarjeta titulo="Abiertas">
        <SegunEstado consulta={abiertas} esqueleto={<Esqueleto lineas={3} />}>
          {(filas) =>
            filas.length === 0 ? (
              <Vacio>
                Ninguna alerta abierta: todas las sucursales reportan y ninguna regla encendida se
                cumple ahora.
              </Vacio>
            ) : (
              <ul className="divide-y divide-linea" data-testid="alertas-abiertas">
                {filas.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <Insignia alerta={a} />
                    <span className="font-medium">{NOMBRE_TIPO[a.tipo]}</span>
                    <span className="min-w-0 flex-1 basis-64">{describirAlerta(a)}</span>
                    <span className="text-xs text-tinta-tenue">
                      Desde {cuando(a.abiertaAt, zonaDe(a))} · lleva {duracion(a.abiertaAt, ahora)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </SegunEstado>
      </Tarjeta>

      <Tarjeta titulo="Historial" className="mt-4">
        <SegunEstado consulta={historial} esqueleto={<Esqueleto lineas={4} />}>
          {(h) =>
            h.total === 0 ? (
              <Vacio>
                Todavía no hay alertas en el historial de este alcance: ninguna regla se ha cumplido
                desde que el centro de alertas empezó a revisar.
              </Vacio>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table
                    className="w-full min-w-0 text-left text-sm"
                    data-testid="alertas-historial"
                  >
                    <thead className="text-xs text-tinta-suave">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Alerta</th>
                        <th className="py-1 pr-3 font-medium">Abrió</th>
                        <th className="py-1 pr-3 font-medium">Cerró</th>
                        <th className="py-1 pr-3 font-medium">Duración</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-linea">
                      {h.filas.map((a) => (
                        <tr key={a.id} className="align-top">
                          <td className="py-2 pr-3">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <Insignia alerta={a} />
                              <span className="font-medium">{NOMBRE_TIPO[a.tipo]}</span>
                            </div>
                            <div className="text-tinta-medio">{describirAlerta(a)}</div>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {cuando(a.abiertaAt, zonaDe(a))}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {a.cerradaAt === null ? (
                              <span className="font-medium text-peligro">Abierta</span>
                            ) : (
                              <>
                                {cuando(a.cerradaAt, zonaDe(a))}
                                <div className="text-xs text-tinta-tenue">
                                  {a.motivoCierre ? NOMBRE_MOTIVO[a.motivoCierre] : ''}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {duracion(
                              a.abiertaAt,
                              a.cerradaAt === null ? ahora : Date.parse(a.cerradaAt),
                            )}
                            {a.cerradaAt === null && ' (sigue)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginador
                  pagina={h.pagina}
                  paginas={Math.max(1, Math.ceil(h.total / h.porPagina))}
                  total={h.total}
                  onCambiar={setPagina}
                />
              </>
            )
          }
        </SegunEstado>
      </Tarjeta>
    </Vista>
  );
}

function Paginador({
  pagina,
  paginas,
  total,
  onCambiar,
}: {
  pagina: number;
  paginas: number;
  total: number;
  onCambiar: (p: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce disabled:opacity-50"
        disabled={pagina <= 1}
        onClick={() => onCambiar(pagina - 1)}
      >
        Anterior
      </button>
      <span data-testid="alertas-pagina">
        Página {pagina} de {paginas} · {total} alerta{total === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce disabled:opacity-50"
        disabled={pagina >= paginas}
        onClick={() => onCambiar(pagina + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}
