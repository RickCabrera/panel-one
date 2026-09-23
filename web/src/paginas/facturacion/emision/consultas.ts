import { pedir } from '../../../api/cliente';
import type {
  ConsultaCancelacion,
  FacturaEmitidaAdmin,
  ReceptorCfdi,
  ResultadoCancelacion,
  ResultadoRefacturacion,
  SolicitudCancelacion,
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

/** Cancelación ante el SAT (F2-109). Con motivo 01, el UUID del sustituto. */
export function cancelarCfdi(
  cfdiId: string,
  body: SolicitudCancelacion,
): Promise<ResultadoCancelacion> {
  return pedir<ResultadoCancelacion>(`/facturacion/cfdis/${cfdiId}/cancelar`, {
    method: 'POST',
    body,
  });
}

/** "Actualizar estado" de una cancelación abierta (F2-109): el api consulta al PAC. */
export function consultarCancelacion(cfdiId: string): Promise<ConsultaCancelacion> {
  return pedir<ConsultaCancelacion>(`/facturacion/cfdis/${cfdiId}/cancelacion/consultar`, {
    method: 'POST',
  });
}
