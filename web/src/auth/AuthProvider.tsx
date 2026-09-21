import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { pedir } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import { AuthContexto, type ContextoAuth, type EstadoAuth } from './contexto';
import {
  marcarSesionCerrada,
  quitarMarcaSesionCerrada,
  sesionCerradaEnEsteNavegador,
} from './marcaCierre';
import {
  cerrarSesionEnServidor,
  establecerSesion,
  refrescarSesion,
  suscribirSesion,
  terminarSesion,
} from './sesion';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Con la marca de "cerró sesión" no hay refresh silencioso: directo a anónimo.
  const [auth, setAuth] = useState<EstadoAuth>(() =>
    sesionCerradaEnEsteNavegador()
      ? { estado: 'anonimo', motivo: 'inicio' }
      : { estado: 'cargando' },
  );

  // El estado de React sigue al módulo de sesión: login, refresh (de cualquiera de
  // los tres caminos) y expiración pasan por ahí.
  useEffect(
    () =>
      suscribirSesion((evento) => {
        if (evento.tipo === 'establecida') {
          setAuth({ estado: 'autenticado', usuario: evento.usuario });
        } else {
          // Los datos de un usuario no se le quedan en caché al siguiente.
          queryClient.clear();
          setAuth({ estado: 'anonimo', motivo: evento.motivo });
        }
      }),
    [queryClient],
  );

  // Refresh silencioso del arranque: si la cookie de refresh sigue viva, se entra
  // directo a la vista pedida, sin pasar por el login. StrictMode monta dos veces;
  // `refrescarSesion` es single-flight, así que sale un solo request.
  useEffect(() => {
    if (sesionCerradaEnEsteNavegador()) return;
    let vivo = true;
    refrescarSesion()
      .then((sesion) => {
        if (vivo && sesion === null) setAuth({ estado: 'anonimo', motivo: 'inicio' });
      })
      .catch(() => {
        if (vivo) setAuth({ estado: 'anonimo', motivo: 'inicio' });
      });
    return () => {
      vivo = false;
    };
  }, []);

  const iniciarSesion = useCallback(async (email: string, password: string) => {
    // `/auth/login` nunca dispara refresh ante un 401 (ver `cliente.ts`).
    const sesion = await pedir<Sesion>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    quitarMarcaSesionCerrada();
    establecerSesion(sesion);
  }, []);

  // En este orden (F1-093): la marca primero, por si la pestaña se cierra a media
  // salida; luego la API revoca la sesión y borra la cookie; al final se limpia el
  // cliente, responda o no la API.
  const cerrarSesion = useCallback(async () => {
    marcarSesionCerrada();
    await cerrarSesionEnServidor();
    terminarSesion('cerrada');
  }, []);

  const valor = useMemo<ContextoAuth>(
    () => ({ auth, iniciarSesion, cerrarSesion }),
    [auth, iniciarSesion, cerrarSesion],
  );

  return <AuthContexto.Provider value={valor}>{children}</AuthContexto.Provider>;
}
