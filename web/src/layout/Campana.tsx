import { Bell } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import { useAlertasAbiertas, useFiltroAlcance } from '../alertas/consultas';
import { queryVista } from '../filtros/vista';

/**
 * Campana de alertas (F2-224), en la cabecera de todas las vistas. Su número es el largo de
 * la MISMA consulta que pinta el panel de `/alertas` (misma llave): no hay un conteo aparte
 * que pueda diferir de las filas.
 *
 * Sin dato todavía, no se pinta un número (un "0" diría "sin alertas" sin saberlo); si la
 * consulta falla, se dice con palabras.
 */
export function Campana() {
  const filtro = useFiltroAlcance();
  const { data, isError } = useAlertasAbiertas(filtro);
  const [parametros] = useSearchParams();

  const total = data?.length;
  const criticas = data?.filter((a) => a.severidad === 'critica').length ?? 0;
  const etiqueta = isError
    ? 'Alertas: no se pudieron leer'
    : total === undefined
      ? 'Alertas: consultando'
      : total === 0
        ? 'Alertas: ninguna abierta'
        : `Alertas: ${total} abierta${total === 1 ? '' : 's'}${criticas > 0 ? `, ${criticas} crítica${criticas === 1 ? '' : 's'}` : ''}`;

  return (
    <Link
      to={{ pathname: '/alertas', search: queryVista(parametros) }}
      aria-label={etiqueta}
      title={etiqueta}
      data-testid="campana-alertas"
      className="relative inline-flex shrink-0 items-center gap-1 rounded-md border border-linea-fuerte px-2 py-1.5 text-sm hover:bg-realce"
    >
      <Bell aria-hidden="true" className="h-4 w-4" />
      {isError ? (
        <span aria-hidden="true" className="text-xs text-peligro">
          !
        </span>
      ) : total !== undefined && total > 0 ? (
        <span
          aria-hidden="true"
          data-testid="campana-conteo"
          className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold ${
            criticas > 0 ? 'bg-peligro-fuerte text-sobre-peligro' : 'bg-aviso-fondo text-aviso'
          }`}
        >
          {total}
        </span>
      ) : null}
    </Link>
  );
}
