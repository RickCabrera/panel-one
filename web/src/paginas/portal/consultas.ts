import { useQuery } from '@tanstack/react-query';

import { ErrorApi, pedir } from '../../api/cliente';
import type {
  CatalogosSat,
  ConsultaCodigoPortal,
  FacturaPortal,
  PortalPublico,
  ReceptorPortal,
} from '../../api/tipos';

/**
 * Las llamadas del portal público de autofactura (F2-103). Todas sin sesión; el api las limita
 * por IP, así que nada se reintenta solo: un 404 o un 429 se muestran tal cual.
 */

const sinReintentos = (fallos: number, error: unknown) =>
  !(error instanceof ErrorApi && error.status >= 400 && error.status < 500) && fallos < 1;

export function usePortal(slug: string) {
  return useQuery({
    queryKey: ['portal-factura', slug],
    queryFn: ({ signal }) =>
      pedir<PortalPublico>(`/facturacion/portal/${encodeURIComponent(slug)}`, { signal }),
    retry: sinReintentos,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCatalogosSat(activo: boolean) {
  return useQuery({
    queryKey: ['portal-factura', 'catalogos-sat'],
    queryFn: ({ signal }) => pedir<CatalogosSat>('/facturacion/catalogos-sat', { signal }),
    enabled: activo,
    retry: sinReintentos,
    staleTime: Infinity,
  });
}

export function consultarCodigo(slug: string, codigo: string): Promise<ConsultaCodigoPortal> {
  return pedir<ConsultaCodigoPortal>(
    `/facturacion/portal/${encodeURIComponent(slug)}/codigo/${encodeURIComponent(codigo)}`,
  );
}

export function pedirFactura(
  slug: string,
  codigo: string,
  receptor: ReceptorPortal,
): Promise<FacturaPortal> {
  return pedir<FacturaPortal>(`/facturacion/portal/${encodeURIComponent(slug)}/facturas`, {
    method: 'POST',
    body: { codigo, receptor },
  });
}
