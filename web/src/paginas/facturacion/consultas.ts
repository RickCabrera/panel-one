import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { GuardarPerfilRespuesta, RegimenFiscal, RespuestaPerfilFiscal } from '../../api/tipos';

/** Todo lo de datos fiscales cuelga de esta llave: guardar o cargar el CSD la invalida. */
export const LLAVE_FACTURACION = ['facturacion'] as const;

/** Los datos fiscales de la empresa y la METADATA de su CSD (F2-100). */
export function usePerfilFiscal(empresaId: string | null) {
  return useQuery({
    queryKey: [...LLAVE_FACTURACION, 'perfil', empresaId],
    queryFn: ({ signal }) =>
      pedir<RespuestaPerfilFiscal>('/facturacion/perfil-fiscal', {
        query: { empresaId },
        signal,
      }),
    enabled: empresaId !== null,
  });
}

/** El catálogo c_RegimenFiscal del SAT (no cambia en la sesión). */
export function useRegimenesFiscales() {
  return useQuery({
    queryKey: [...LLAVE_FACTURACION, 'regimenes'],
    queryFn: ({ signal }) => pedir<RegimenFiscal[]>('/facturacion/regimenes-fiscales', { signal }),
    staleTime: Infinity,
  });
}

export interface DatosPerfil {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  serie: string;
}

export function guardarPerfil(
  empresaId: string,
  datos: DatosPerfil,
): Promise<GuardarPerfilRespuesta> {
  return pedir<GuardarPerfilRespuesta>('/facturacion/perfil-fiscal', {
    method: 'PUT',
    body: { empresaId, ...datos },
  });
}

/**
 * Sube el CSD. Los archivos van en base64 y la contraseña tal cual, en el cuerpo de UNA petición
 * al api; aquí no se guardan en ningún lado (ni estado global, ni storage, ni caché de consultas).
 */
export function cargarCsd(body: {
  empresaId: string;
  certificado: string;
  llavePrivada: string;
  contrasena: string;
}): Promise<RespuestaPerfilFiscal> {
  return pedir<RespuestaPerfilFiscal>('/facturacion/perfil-fiscal/csd', { method: 'POST', body });
}
