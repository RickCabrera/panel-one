import { pedir } from '../../../api/cliente';
import type {
  FacturaEmitidaAdmin,
  ReceptorCfdi,
  ResultadoRefacturacion,
  SolicitudFacturaManual,
} from '../../../api/tipos';

/** Factura sin ticket (F2-107). La `solicitudId` hace que un reintento no emita dos veces. */
export function emitirFacturaManual(body: SolicitudFacturaManual): Promise<FacturaEmitidaAdmin> {
  return pedir<FacturaEmitidaAdmin>('/facturacion/cfdis/manual', { method: 'POST', body });
}

/** Refacturación (F2-107): sustituto 04 + cancelación 01. Repetirla reintenta sólo la cancelación. */
export function refacturarCfdi(
  cfdiId: string,
  receptor: ReceptorCfdi,
): Promise<ResultadoRefacturacion> {
  return pedir<ResultadoRefacturacion>(`/facturacion/cfdis/${cfdiId}/refacturar`, {
    method: 'POST',
    body: { receptor },
  });
}
