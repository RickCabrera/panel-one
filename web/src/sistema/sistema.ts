import { useQuery } from '@tanstack/react-query';

import { pedir } from '../api/cliente';
import type { Sistema } from '../api/tipos';

/** Clave de la consulta. La limpieza de caché al cerrar sesión la conserva. */
export const CLAVE_SISTEMA = 'sistema';

export const TEXTO_MARCA_DEMO = 'Datos de ejemplo';
export const PREFIJO_TITULO_DEMO = `[${TEXTO_MARCA_DEMO}] `;

/** `GET /sistema` es público: se pide una vez, antes del login, y no caduca. */
export function useSistema() {
  return useQuery({
    queryKey: [CLAVE_SISTEMA],
    queryFn: ({ signal }) => pedir<Sistema>('/sistema', { signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
