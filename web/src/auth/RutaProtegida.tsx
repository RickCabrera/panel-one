import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import type { Rol } from '../api/tipos';
import { NoEncontrada } from '../paginas/NoEncontrada';
import { PantallaCarga } from '../paginas/PantallaCarga';
import { useAuth } from './contexto';
import { rutaLogin } from './siguiente';

/**
 * Sin sesión, manda al login recordando la vista EXACTA (ruta + query string, o sea
 * los filtros de empresa/sucursal). Es lo que hace funcionar el deep-link.
 */
export function RutaProtegida({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { pathname, search } = useLocation();

  if (auth.estado === 'cargando') return <PantallaCarga />;
  if (auth.estado === 'anonimo') return <Navigate to={rutaLogin(pathname + search)} replace />;
  return children;
}

/**
 * Vista restringida por rol. A quien no le toca ve "No encontrada", no "Prohibido":
 * igual que la API (404, nunca 403), no se confirma que la vista exista.
 */
export function RequiereRol({ roles, children }: { roles: readonly Rol[]; children: ReactNode }) {
  const { auth } = useAuth();
  if (auth.estado !== 'autenticado' || !roles.includes(auth.usuario.rol)) return <NoEncontrada />;
  return children;
}
