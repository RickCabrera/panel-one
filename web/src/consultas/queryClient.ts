import { QueryClient } from '@tanstack/react-query';

import { ErrorApi } from '../api/cliente';

/** Errores que no mejoran reintentando: el mismo request va a dar lo mismo. */
const SIN_REINTENTO = new Set([400, 401, 403, 404]);

export function crearQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Lo pide el backlog (F1-040) y coincide con el cache de 15 s de la API.
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (fallos, error) =>
          !(error instanceof ErrorApi && SIN_REINTENTO.has(error.status)) && fallos < 1,
      },
    },
  });
}
