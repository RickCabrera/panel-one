import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { pedir } from '../../api/cliente';
import type {
  AdminInterno,
  AltaCliente,
  Bitacora,
  ClienteDetalle,
  ClienteResumen,
  ColorAcento,
  ContactoCliente,
  CuentaCliente,
  EstadoMembresia,
  EstadoPagoMes,
  EstadoSuscripcion,
  MembresiaPropia,
  MetricasPlataforma,
  PagoSuscripcion,
  PagosMes,
  Plan,
  RegistrarPago,
  Suscripcion,
} from '../../api/tipos';
import { CLAVE_SISTEMA } from '../../sistema/sistema';

/**
 * Las consultas del panel de plataforma (membresías). Todas cuelgan de la llave `plataforma`:
 * tras cualquier escritura se invalida la llave entera (las cifras de un cliente salen en el
 * tablero, en Clientes, en Pagos y en la bitácora a la vez).
 */
export const CLAVE_PLATAFORMA = 'plataforma';

export function useMetricas() {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'metricas'],
    queryFn: ({ signal }) => pedir<MetricasPlataforma>('/plataforma/metricas', { signal }),
  });
}

export function usePlanes() {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'planes'],
    queryFn: ({ signal }) => pedir<Plan[]>('/plataforma/planes', { signal }),
  });
}

export type FiltroEstadoCliente = EstadoMembresia | 'sin_suscripcion' | '';

export function useClientes(estado: FiltroEstadoCliente, q: string) {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'clientes', estado, q],
    queryFn: ({ signal }) =>
      pedir<ClienteResumen[]>('/plataforma/clientes', {
        query: { estado: estado || undefined, q: q || undefined },
        signal,
      }),
  });
}

export function useCliente(id: string | undefined) {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'cliente', id],
    queryFn: ({ signal }) => pedir<ClienteDetalle>(`/plataforma/clientes/${id}`, { signal }),
    enabled: id !== undefined,
  });
}

export function usePagosDelMes(estado: EstadoPagoMes | '', q: string) {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'pagos', estado, q],
    queryFn: ({ signal }) =>
      pedir<PagosMes>('/plataforma/pagos', {
        query: { estado: estado || undefined, q: q || undefined },
        signal,
      }),
  });
}

export function useAdministradores() {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'administradores'],
    queryFn: ({ signal }) => pedir<AdminInterno[]>('/plataforma/administradores', { signal }),
  });
}

export function useBitacora(pagina: number, porPagina = 25) {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'bitacora', pagina, porPagina],
    queryFn: ({ signal }) =>
      pedir<Bitacora>('/plataforma/bitacora', { query: { pagina, porPagina }, signal }),
  });
}

export function useAjustes() {
  return useQuery({
    queryKey: [CLAVE_PLATAFORMA, 'ajustes'],
    queryFn: ({ signal }) =>
      pedir<{ colorAcento: ColorAcento | null }>('/plataforma/ajustes', { signal }),
  });
}

/**
 * La membresía de la empresa del usuario (para el aviso de pago pendiente). Si falla, no hay
 * aviso: es la opción que no inventa.
 */
export function useMembresiaPropia(habilitada: boolean) {
  return useQuery({
    queryKey: ['membresia-propia'],
    queryFn: async ({ signal }) =>
      (await pedir<{ membresia: MembresiaPropia | null }>('/cuenta/membresia', { signal }))
        .membresia,
    enabled: habilitada,
    staleTime: 5 * 60_000,
  });
}

/**
 * Las escrituras, como funciones sueltas y NO como `useMutation` (mismo criterio que la
 * administración): la contraseña inicial de un admin o de un cliente vive sólo en su formulario.
 */
export const apiPlataforma = {
  crearPlan: (datos: Partial<Plan> & { nombre: string; precioMensual: string }) =>
    pedir<Plan>('/plataforma/planes', { method: 'POST', body: datos }),
  editarPlan: (id: string, cambios: Partial<Omit<Plan, 'id' | 'clientes'>>) =>
    pedir<Plan>(`/plataforma/planes/${id}`, { method: 'PATCH', body: cambios }),
  borrarPlan: (id: string) => pedir<void>(`/plataforma/planes/${id}`, { method: 'DELETE' }),
  altaCliente: (datos: AltaCliente) =>
    pedir<ClienteDetalle>('/plataforma/clientes', { method: 'POST', body: datos }),
  editarCliente: (id: string, cambios: Partial<ContactoCliente> & { nombre?: string }) =>
    pedir<ClienteDetalle>(`/plataforma/clientes/${id}`, { method: 'PATCH', body: cambios }),
  guardarSuscripcion: (
    id: string,
    cambios: {
      planId?: string;
      vencimiento?: string;
      diaCorte?: number;
      diasGracia?: number;
      notas?: string | null;
    },
  ) =>
    pedir<Suscripcion>(`/plataforma/clientes/${id}/suscripcion`, { method: 'PUT', body: cambios }),
  cambiarEstado: (id: string, estado: EstadoSuscripcion, motivo?: string) =>
    pedir<Suscripcion>(`/plataforma/clientes/${id}/estado`, {
      method: 'POST',
      body: { estado, ...(motivo ? { motivo } : {}) },
    }),
  registrarPago: (empresaId: string, datos: RegistrarPago) =>
    pedir<{ pago: PagoSuscripcion; suscripcion: Suscripcion }>(
      `/plataforma/clientes/${empresaId}/pagos`,
      { method: 'POST', body: datos },
    ),
  anularPago: (pagoId: string, motivo: string) =>
    pedir<PagoSuscripcion>(`/plataforma/pagos/${pagoId}/anular`, {
      method: 'POST',
      body: { motivo },
    }),
  crearAdmin: (datos: { nombre: string; email: string; password: string }) =>
    pedir<AdminInterno>('/plataforma/administradores', { method: 'POST', body: datos }),
  editarAdmin: (id: string, cambios: { nombre?: string; email?: string; activo?: boolean }) =>
    pedir<AdminInterno>(`/plataforma/administradores/${id}`, { method: 'PATCH', body: cambios }),
  buscarCuenta: (email: string) =>
    pedir<CuentaCliente>('/plataforma/administradores/buscar-cuenta', { query: { email } }),
  convertirCuenta: (usuarioId: string) =>
    pedir<{ admin: AdminInterno; empresaId: string; empresaSinAdmin: boolean }>(
      '/plataforma/administradores/convertir',
      { method: 'POST', body: { usuarioId } },
    ),
  guardarAjustes: (colorAcento: ColorAcento | null) =>
    pedir<{ colorAcento: ColorAcento | null }>('/plataforma/ajustes', {
      method: 'PUT',
      body: { colorAcento },
    }),
};

/**
 * Corre una escritura con su estado local (en curso / error) y, si sale bien, invalida todo
 * `plataforma` (y `sistema` si `sistema: true`: el color global). Devuelve `{ ok, valor }`.
 */
export function useAccionPlataforma() {
  const cliente = useQueryClient();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correr = useCallback(
    async <T>(
      accion: () => Promise<T>,
      opciones: { sistema?: boolean } = {},
    ): Promise<{ ok: true; valor: T } | { ok: false }> => {
      setEnCurso(true);
      setError(null);
      try {
        const valor = await accion();
        await Promise.all([
          cliente.invalidateQueries({ queryKey: [CLAVE_PLATAFORMA] }),
          opciones.sistema ? cliente.invalidateQueries({ queryKey: [CLAVE_SISTEMA] }) : null,
        ]);
        return { ok: true, valor };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Algo salió mal.');
        return { ok: false };
      } finally {
        setEnCurso(false);
      }
    },
    [cliente],
  );

  const limpiar = useCallback(() => setError(null), []);
  return { correr, enCurso, error, limpiar };
}
