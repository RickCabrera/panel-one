import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AuthProvider } from './auth/AuthProvider';
import { ROLES_ADMIN } from './auth/roles';
import { RequiereRol, RutaProtegida } from './auth/RutaProtegida';
import { crearQueryClient } from './consultas/queryClient';
import { Layout } from './layout/Layout';
import { Administracion } from './paginas/Administracion';
import { Analisis } from './paginas/Analisis';
import { Comparativos } from './paginas/Comparativos';
import { Cuenta } from './paginas/Cuenta';
import { Inicio } from './paginas/Inicio';
import { Login } from './paginas/Login';
import { Mesas } from './paginas/Mesas';
import { MesasPared } from './paginas/MesasPared';
import { NoEncontrada } from './paginas/NoEncontrada';
import { Reportes } from './paginas/Reportes';
import { Resumen } from './paginas/Resumen';
import { Tickets } from './paginas/Tickets';
import { MarcaDemo } from './sistema/MarcaDemo';
import { ProveedorTema } from './tema/ProveedorTema';

/** Proveedores de la app, sin router: los tests los montan con un `MemoryRouter`. */
export function Proveedores({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* F2-202: la marca del modo demo va sobre TODAS las vistas, login incluido. */}
      <MarcaDemo />
      <AuthProvider>
        {/* F2-211: dentro de Auth, para cargar la preferencia del usuario que entra. */}
        <ProveedorTema>{children}</ProveedorTema>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* F2-223: la vista de pared va FUERA de Layout (sin menú ni cabecera). */}
      <Route
        path="/mesas/pared"
        element={
          <RutaProtegida>
            <MesasPared />
          </RutaProtegida>
        }
      />
      <Route
        element={
          <RutaProtegida>
            <Layout />
          </RutaProtegida>
        }
      >
        <Route index element={<Inicio />} />
        <Route path="resumen" element={<Resumen />} />
        <Route path="comparativos" element={<Comparativos />} />
        <Route path="analisis" element={<Analisis />} />
        <Route path="mesas" element={<Mesas />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="cuenta" element={<Cuenta />} />
        <Route
          path="admin"
          element={
            <RequiereRol roles={ROLES_ADMIN}>
              <Administracion />
            </RequiereRol>
          }
        />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [queryClient] = useState(crearQueryClient);
  return (
    <BrowserRouter>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </BrowserRouter>
  );
}
