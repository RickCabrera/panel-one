import { useState } from 'react';
import { Link } from 'react-router';

import { Cabecera, Cargando, ErrorCarga } from './Comunes';
import { useBitacora } from './consultas';
import { C } from './estilos';
import { fechaHora, TEXTO_ACCION } from './formato';

const POR_PAGINA = 25;

/** "antes → después" de una entrada, sólo con los campos que cambiaron. */
function cambios(antes: unknown, despues: unknown): string[] {
  const a = (antes && typeof antes === 'object' ? antes : {}) as Record<string, unknown>;
  const d = (despues && typeof despues === 'object' ? despues : {}) as Record<string, unknown>;
  const llaves = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  const texto = (v: unknown) =>
    v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return llaves
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((k) => (k in a ? `${k}: ${texto(a[k])} → ${texto(d[k])}` : `${k}: ${texto(d[k])}`));
}

/** Bitácora: quién hizo qué en la plataforma, cuándo y sobre qué cliente. */
export function Bitacora() {
  const [pagina, setPagina] = useState(1);
  const bitacora = useBitacora(pagina, POR_PAGINA);
  const paginas = bitacora.data ? Math.max(1, Math.ceil(bitacora.data.total / POR_PAGINA)) : 1;

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Bitácora"
        subtitulo="Todo lo que se hace en esta administración, de lo más reciente a lo más viejo."
      />
      {bitacora.isPending ? (
        <Cargando que="la bitácora" />
      ) : bitacora.isError ? (
        <ErrorCarga que="la bitácora" />
      ) : bitacora.data.entradas.length === 0 ? (
        <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>Todavía no hay movimientos.</p>
      ) : (
        <ul aria-label="Bitácora" className={C.lista}>
          {bitacora.data.entradas.map((e) => {
            const detalle = cambios(e.antes, e.despues);
            return (
              <li key={e.id} className="space-y-1 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{TEXTO_ACCION[e.accion] ?? e.accion}</span>
                  <time dateTime={e.createdAt} className="text-xs text-tinta-tenue">
                    {fechaHora(e.createdAt)}
                  </time>
                </div>
                <div className={C.filaDetalle}>
                  {e.actorEmail}
                  {e.empresaId && (
                    <>
                      {' · '}
                      <Link
                        className="text-acento-texto hover:underline"
                        to={`/plataforma/clientes/${e.empresaId}`}
                      >
                        {e.empresa ?? 'cliente'}
                      </Link>
                    </>
                  )}
                </div>
                {detalle.length > 0 && (
                  <details className="text-xs text-tinta-suave">
                    <summary className="cursor-pointer">Antes y después</summary>
                    <ul className="mt-1 space-y-0.5 font-mono break-all">
                      {detalle.map((linea) => (
                        <li key={linea}>{linea}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <nav aria-label="Páginas" className="flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          className={C.secundario}
          disabled={pagina <= 1}
          onClick={() => setPagina(pagina - 1)}
        >
          Anterior
        </button>
        <span className="text-tinta-suave">
          Página {pagina} de {paginas}
        </span>
        <button
          type="button"
          className={C.secundario}
          disabled={pagina >= paginas}
          onClick={() => setPagina(pagina + 1)}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}
