import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../../api/cliente';
import type { EstadoFolios, ReporteFolios } from '../../../api/tipos';

/** Todo el control de folios cuelga de esta llave: registrar, borrar o configurar la invalida. */
export const LLAVE_FOLIOS = ['facturacion', 'folios'] as const;

export function useEstadoFolios() {
  return useQuery({
    queryKey: [...LLAVE_FOLIOS, 'estado'],
    queryFn: ({ signal }) => pedir<EstadoFolios>('/facturacion/folios', { signal }),
  });
}

export function useReporteFolios(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...LLAVE_FOLIOS, 'reporte', desde, hasta],
    queryFn: ({ signal }) =>
      pedir<ReporteFolios>('/facturacion/folios/reporte', { query: { desde, hasta }, signal }),
  });
}

export function registrarPaquete(body: {
  cantidad: number;
  fechaCompra: string;
  nota?: string;
}): Promise<{ id: string }> {
  return pedir<{ id: string }>('/facturacion/folios/paquetes', { method: 'POST', body });
}

export function borrarPaquete(id: string): Promise<void> {
  return pedir<void>(`/facturacion/folios/paquetes/${id}`, { method: 'DELETE' });
}

export function guardarUmbral(umbralPct: number): Promise<EstadoFolios> {
  return pedir<EstadoFolios>('/facturacion/folios/configuracion', {
    method: 'PUT',
    body: { umbralPct },
  });
}
