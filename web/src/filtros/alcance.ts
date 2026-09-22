import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { pedir } from '../api/cliente';
import type { Empresa, Sucursal } from '../api/tipos';
import { useAuth } from '../auth/contexto';

/**
 * El alcance del panel —qué empresa y qué sucursal se están viendo— vive en la URL
 * (`?empresa=&sucursal=`), no en estado de React ni en localStorage. Así un enlace
 * copiado abre exactamente la misma vista, y el botón "atrás" deshace un cambio de
 * sucursal. `sucursal` ausente = todas las sucursales de la empresa.
 */
export const PARAM_EMPRESA = 'empresa';
export const PARAM_SUCURSAL = 'sucursal';

export function useEmpresas() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ['empresas'],
    queryFn: ({ signal }) => pedir<Empresa[]>('/empresas', { signal }),
    enabled: auth.estado === 'autenticado',
  });
}

export function useSucursales(empresaId: string | undefined) {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ['sucursales', empresaId],
    queryFn: ({ signal }) => pedir<Sucursal[]>('/sucursales', { query: { empresaId }, signal }),
    enabled: auth.estado === 'autenticado' && empresaId !== undefined,
  });
}

export function useAlcance() {
  const [parametros, setParametros] = useSearchParams();
  const empresaId = parametros.get(PARAM_EMPRESA);
  const sucursalId = parametros.get(PARAM_SUCURSAL);

  const empresas = useEmpresas();
  const empresa = empresas.data?.find((e) => e.id === empresaId);
  // Sólo se piden las sucursales de una empresa que SÍ está en la lista: con una
  // empresa ajena en la URL la API respondería 404, y la normalización la corrige.
  const sucursales = useSucursales(empresa?.id);
  const sucursal = sucursales.data?.find((s) => s.id === sucursalId);

  const elegirEmpresa = useCallback(
    (id: string) =>
      setParametros((previos) => {
        const nuevos = new URLSearchParams(previos);
        nuevos.set(PARAM_EMPRESA, id);
        // Una sucursal nunca sobrevive a un cambio de empresa: sería de otra.
        nuevos.delete(PARAM_SUCURSAL);
        return nuevos;
      }),
    [setParametros],
  );

  const elegirSucursal = useCallback(
    (id: string | null) =>
      setParametros((previos) => {
        const nuevos = new URLSearchParams(previos);
        if (id) nuevos.set(PARAM_SUCURSAL, id);
        else nuevos.delete(PARAM_SUCURSAL);
        return nuevos;
      }),
    [setParametros],
  );

  return {
    empresaId,
    sucursalId,
    empresa,
    sucursal,
    empresas,
    sucursales,
    elegirEmpresa,
    elegirSucursal,
  };
}

/**
 * Corrige la URL cuando el alcance no es válido: sin empresa, o con una que no está
 * en tu lista → la primera de la lista; una sucursal que no es de la empresa → se
 * quita. Usa `replace` para no ensuciar el historial.
 *
 * SÓLO corrige con la lista cargada con éxito. Mientras carga, o si falla (red,
 * 500), la URL no se toca: borrar el deep-link por un error pasajero es justo lo que
 * el criterio de F1-040 prohíbe.
 */
export function useNormalizarAlcance(): void {
  const [, setParametros] = useSearchParams();
  const { empresaId, sucursalId, empresa, sucursal, empresas, sucursales } = useAlcance();
  const primera = empresas.isSuccess ? empresas.data[0] : undefined;

  useEffect(() => {
    if (!empresas.isSuccess || !primera) return;
    if (!empresa) {
      setParametros(
        (previos) => {
          const nuevos = new URLSearchParams(previos);
          nuevos.set(PARAM_EMPRESA, primera.id);
          nuevos.delete(PARAM_SUCURSAL);
          return nuevos;
        },
        { replace: true },
      );
      return;
    }
    if (sucursalId && sucursales.isSuccess && !sucursal) {
      setParametros(
        (previos) => {
          const nuevos = new URLSearchParams(previos);
          nuevos.delete(PARAM_SUCURSAL);
          return nuevos;
        },
        { replace: true },
      );
    }
  }, [
    empresas.isSuccess,
    primera,
    empresa,
    empresaId,
    sucursalId,
    sucursales.isSuccess,
    sucursal,
    setParametros,
  ]);
}
