import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { pedir } from '../../api/cliente';
import { POLLING_MS } from '../mesas/reglas';
import type {
  AltaGuiada,
  AltaGuiadaHecha,
  ApiKeyEmitida,
  Arranque,
  CrearSucursal,
  CrearUsuario,
  EditarEmpresa,
  EditarSucursal,
  EditarUsuario,
  Empresa,
  EstadoAgenteSucursal,
  Sucursal,
  VersionAgente,
  UsuarioAdmin,
} from '../../api/tipos';

/**
 * Estado de los agentes de una empresa (F1-061), cada 20 s como el Monitor de Mesas.
 * La tabla y el badge del sidebar comparten la llave: una sola petición. Sólo la
 * montan vistas de admin (el badge cuelga de la entrada "Administración", que el
 * visor no ve); para el visor la API da 403.
 */
export function useEstadoAgentes(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['agentes', 'estado', empresaId],
    queryFn: ({ signal }) =>
      pedir<EstadoAgenteSucursal[]>('/agentes/estado', { query: { empresaId }, signal }),
    enabled: empresaId !== undefined,
    refetchInterval: POLLING_MS,
  });
}

/** Usuarios de una empresa (F1-060). La API da 404 si la empresa no es tuya. */
export function useUsuarios(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['usuarios', empresaId],
    queryFn: ({ signal }) => pedir<UsuarioAdmin[]>('/usuarios', { query: { empresaId }, signal }),
    enabled: empresaId !== undefined,
  });
}

/**
 * Los admin_global (sin empresa). La API sólo se los lista a otro admin_global
 * (`GET /usuarios` sin filtro trae TODOS los de su alcance, que para él es todo);
 * aquí se quedan los que no tienen empresa.
 */
export function useAdminsGlobales(habilitado: boolean) {
  return useQuery({
    queryKey: ['usuarios', 'globales'],
    queryFn: async ({ signal }) =>
      (await pedir<UsuarioAdmin[]>('/usuarios', { signal })).filter((u) => u.empresaId === null),
    enabled: habilitado,
  });
}

/**
 * Las escrituras de la administración, como funciones sueltas y NO como
 * `useMutation`: TanStack guarda las variables y la respuesta de cada mutación en su
 * caché varios minutos, y aquí viajan contraseñas y la API key en claro. Con estas
 * funciones la contraseña vive sólo en el formulario y la key sólo en el modal que
 * la muestra. Tras cada escritura se invalida la lista que cambió (empresas y
 * sucursales también alimentan el selector del Topbar).
 */
export const api = {
  crearEmpresa: (nombre: string) =>
    pedir<Empresa>('/empresas', { method: 'POST', body: { nombre } }),
  editarEmpresa: (id: string, cambios: EditarEmpresa) =>
    pedir<Empresa>(`/empresas/${id}`, { method: 'PATCH', body: cambios }),
  crearSucursal: (datos: CrearSucursal) =>
    pedir<Sucursal>('/sucursales', { method: 'POST', body: datos }),
  editarSucursal: (id: string, cambios: EditarSucursal) =>
    pedir<Sucursal>(`/sucursales/${id}`, { method: 'PATCH', body: cambios }),
  // F2-143: el canal de versiones del agente y la bandera de rollout (sólo admin_global).
  publicarVersionAgente: (version: string, notas: string, binario: Blob) =>
    pedir<VersionAgente>('/agente/versiones', {
      method: 'POST',
      query: { version, notas: notas.trim() || undefined },
      binario,
    }),
  retirarVersionAgente: (version: string) =>
    pedir<VersionAgente>(`/agente/versiones/${encodeURIComponent(version)}/retirar`, {
      method: 'POST',
    }),
  actualizacionAutomatica: (sucursalId: string, activa: boolean) =>
    pedir<{ sucursalId: string; actualizacionAutomatica: boolean }>(
      `/sucursales/${sucursalId}/actualizacion-automatica`,
      { method: 'PUT', body: { activa } },
    ),
  rotarApiKey: (sucursalId: string) =>
    pedir<ApiKeyEmitida>(`/sucursales/${sucursalId}/api-key`, { method: 'POST' }),
  crearUsuario: (datos: CrearUsuario) =>
    pedir<UsuarioAdmin>('/usuarios', { method: 'POST', body: datos }),
  editarUsuario: (id: string, cambios: EditarUsuario) =>
    pedir<UsuarioAdmin>(`/usuarios/${id}`, { method: 'PATCH', body: cambios }),
  resetPassword: (id: string, password: string) =>
    pedir<void>(`/usuarios/${id}/password`, { method: 'POST', body: { password } }),
  // F2-147: la respuesta trae las keys EN CLARO; vive sólo en el estado del asistente.
  altaGuiada: (datos: AltaGuiada) =>
    pedir<AltaGuiadaHecha>('/empresas/alta-guiada', { method: 'POST', body: datos }),
};

/**
 * El checklist de arranque de una empresa (F2-147). Se relee cada 20 s mientras esté
 * incompleto: el paso del agente se marca solo cuando el agente se reporta. Completo, deja
 * de preguntar. Sólo para admins (al visor la API le da 403 y la tarjeta ni se monta).
 */
export function useArranque(empresaId: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: ['arranque', empresaId],
    queryFn: ({ signal }) => pedir<Arranque>(`/empresas/${empresaId}/arranque`, { signal }),
    enabled: habilitado && empresaId !== undefined,
    refetchInterval: (consulta) => (consulta.state.data?.completo ? false : POLLING_MS),
  });
}

// F2-143: 'agentes' (el estado, con la bandera de rollout) y 'versiones-agente' (el canal).
type Lista = 'empresas' | 'sucursales' | 'usuarios' | 'agentes' | 'versiones-agente';

/** El canal de versiones del agente (F2-143). Sólo lo monta la pestaña de admin_global. */
export function useVersionesAgente() {
  return useQuery({
    queryKey: ['versiones-agente'],
    queryFn: ({ signal }) => pedir<VersionAgente[]>('/agente/versiones', { signal }),
  });
}

/**
 * Corre una escritura con su estado local (en curso / error) y, si sale bien,
 * invalida las listas indicadas. Devuelve `{ ok, valor }`; si falló, el mensaje
 * queda en `error` para mostrarlo junto al formulario.
 */
export function useAccion() {
  const cliente = useQueryClient();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correr = useCallback(
    async <T>(
      accion: () => Promise<T>,
      invalida: readonly Lista[] = [],
    ): Promise<{ ok: true; valor: T } | { ok: false }> => {
      setEnCurso(true);
      setError(null);
      try {
        const resultado = await accion();
        await Promise.all(invalida.map((c) => cliente.invalidateQueries({ queryKey: [c] })));
        return { ok: true, valor: resultado };
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
