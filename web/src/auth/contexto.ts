import { createContext, useContext } from 'react';

import type { UsuarioActual } from '../api/tipos';

export type EstadoAuth =
  | { estado: 'cargando' }
  | { estado: 'anonimo'; motivo: 'inicio' | 'cerrada' | 'expirada' }
  | { estado: 'autenticado'; usuario: UsuarioActual };

export interface ContextoAuth {
  auth: EstadoAuth;
  /** Lanza `ErrorApi` con el status de la API (401, 429...) o 0 si no hubo red. */
  iniciarSesion: (email: string, password: string) => Promise<void>;
  cerrarSesion: () => void;
}

export const AuthContexto = createContext<ContextoAuth | null>(null);

export function useAuth(): ContextoAuth {
  const valor = useContext(AuthContexto);
  if (!valor) throw new Error('useAuth fuera de <AuthProvider>');
  return valor;
}

/** El usuario autenticado. Sólo para componentes detrás de `RutaProtegida`. */
export function useUsuario(): UsuarioActual {
  const { auth } = useAuth();
  if (auth.estado !== 'autenticado') throw new Error('useUsuario sin sesión');
  return auth.usuario;
}
