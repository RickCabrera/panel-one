import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AuthProvider } from './auth/AuthProvider';
import { SoloInterno } from './auth/SoloInterno';
import { ROLES_ADMIN } from './auth/roles';
import { RequiereRol, RutaProtegida } from './auth/RutaProtegida';
import { crearQueryClient } from './consultas/queryClient';
import { Layout } from './layout/Layout';
import { Administracion } from './paginas/Administracion';
import { AltaGuiada } from './paginas/AltaGuiada';
import { Alertas } from './paginas/Alertas';
import { Analisis } from './paginas/Analisis';
import { BajaReportes } from './paginas/BajaReportes';
import { Comparativos } from './paginas/Comparativos';
import { RedirigirATurnos } from './paginas/cortes/RedirigirATurnos';
import { Cuenta } from './paginas/Cuenta';
import { AyudaAgente } from './paginas/AyudaAgente';
import { AyudaConteos } from './paginas/AyudaConteos';
import { ConteoCaptura } from './paginas/ConteoCaptura';
import { Conteos } from './paginas/Conteos';
import { Existencias } from './paginas/Existencias';
import { Facturacion } from './paginas/Facturacion';
import { Areas } from './paginas/Areas';
import { Canales } from './paginas/Canales';
import { Clientes } from './paginas/Clientes';
import { Inicio } from './paginas/Inicio';
import { Login } from './paginas/Login';
import { Menu } from './paginas/Menu';
import { Meseros } from './paginas/Meseros';
import { Movimientos } from './paginas/Movimientos';
import { Mesas } from './paginas/Mesas';
import { Productos } from './paginas/Productos';
import { MesasPared } from './paginas/MesasPared';
import { NoEncontrada } from './paginas/NoEncontrada';
import { PortalFactura } from './paginas/PortalFactura';
import { Administradores as PlataformaAdministradores } from './paginas/plataforma/Administradores';
import { Ajustes as PlataformaAjustes } from './paginas/plataforma/Ajustes';
import { Bitacora as PlataformaBitacora } from './paginas/plataforma/Bitacora';
import { ClienteDetalle as PlataformaCliente } from './paginas/plataforma/ClienteDetalle';
import { Clientes as PlataformaClientes } from './paginas/plataforma/Clientes';
import { LayoutPlataforma } from './paginas/plataforma/LayoutPlataforma';
import { Pagos as PlataformaPagos } from './paginas/plataforma/Pagos';
import { Planes as PlataformaPlanes } from './paginas/plataforma/Planes';
import { Tablero as PlataformaTablero } from './paginas/plataforma/Tablero';
import { Reportes } from './paginas/Reportes';
import { Resumen } from './paginas/Resumen';
import { Tickets } from './paginas/Tickets';
import { Turnos } from './paginas/Turnos';
import { TraspasoDetalle } from './paginas/TraspasoDetalle';
import { TraspasoNuevo } from './paginas/TraspasoNuevo';
import { Compras } from './paginas/Compras';
import { Gastos } from './paginas/Gastos';
import { Proyecciones } from './paginas/Proyecciones';
import { Recetas } from './paginas/Recetas';
import { Traspasos } from './paginas/Traspasos';
import { MarcaDemo } from './sistema/MarcaDemo';
import { TemaConAcentoGlobal } from './tema/AcentoGlobal';

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
        {/* F2-211: dentro de Auth, para cargar la preferencia del usuario que entra. Con el
            color global de la plataforma (membresías), si eligió uno. */}
        <TemaConAcentoGlobal>{children}</TemaConAcentoGlobal>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* F2-141: la baja desde el correo es PÚBLICA (sin sesión): fuera de RutaProtegida. */}
      <Route path="/reportes/baja" element={<BajaReportes />} />
      {/* F2-103: el portal de autofactura es PÚBLICO (el cliente llega desde el QR del ticket). */}
      <Route path="/f/:slug" element={<PortalFactura />} />
      {/* F2-223: la vista de pared va FUERA de Layout (sin menú ni cabecera). */}
      <Route
        path="/mesas/pared"
        element={
          <RutaProtegida>
            <MesasPared />
          </RutaProtegida>
        }
      />
      {/* Membresías: el panel de plataforma, con su propia barra lateral (fuera de Layout).
          Sólo admin_global: a cualquier otro rol, "No encontrada" (la API, además, da 404). */}
      <Route
        path="/plataforma"
        element={
          <RutaProtegida>
            <RequiereRol roles={['admin_global']}>
              <LayoutPlataforma />
            </RequiereRol>
          </RutaProtegida>
        }
      >
        <Route index element={<PlataformaTablero />} />
        <Route path="clientes" element={<PlataformaClientes />} />
        <Route path="clientes/:id" element={<PlataformaCliente />} />
        <Route path="pagos" element={<PlataformaPagos />} />
        <Route path="planes" element={<PlataformaPlanes />} />
        <Route path="ajustes" element={<PlataformaAjustes />} />
        <Route path="administradores" element={<PlataformaAdministradores />} />
        <Route path="bitacora" element={<PlataformaBitacora />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
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
        {/* UI-01: "Cortes" pasó a "Turnos" en la interfaz; la ruta vieja redirige con su query. */}
        <Route path="turnos" element={<Turnos />} />
        <Route path="cortes" element={<RedirigirATurnos />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="alertas" element={<Alertas />} />
        {/* MVP: lo que va en <SoloInterno> no lo ve ningún cliente (ver auth/mvp.ts). */}
        <Route path="productos" element={<Productos />} />
        {/* `/menu` y no `/productos/menu`: el menú lateral marcaría activas las dos. */}
        <Route
          path="menu"
          element={
            <SoloInterno>
              <Menu />
            </SoloInterno>
          }
        />
        <Route path="meseros" element={<Meseros />} />
        <Route
          path="clientes"
          element={
            <SoloInterno>
              <Clientes />
            </SoloInterno>
          }
        />
        <Route
          path="areas"
          element={
            <SoloInterno>
              <Areas />
            </SoloInterno>
          }
        />
        <Route path="canales" element={<Canales />} />
        <Route
          path="existencias"
          element={
            <SoloInterno>
              <Existencias />
            </SoloInterno>
          }
        />
        <Route
          path="movimientos"
          element={
            <SoloInterno>
              <Movimientos />
            </SoloInterno>
          }
        />
        <Route
          path="conteos"
          element={
            <SoloInterno>
              <Conteos />
            </SoloInterno>
          }
        />
        <Route
          path="conteos/ayuda"
          element={
            <SoloInterno>
              <AyudaConteos />
            </SoloInterno>
          }
        />
        <Route
          path="conteos/:id"
          element={
            <SoloInterno>
              <ConteoCaptura />
            </SoloInterno>
          }
        />
        <Route
          path="traspasos"
          element={
            <SoloInterno>
              <Traspasos />
            </SoloInterno>
          }
        />
        <Route
          path="traspasos/nuevo"
          element={
            <SoloInterno>
              <TraspasoNuevo />
            </SoloInterno>
          }
        />
        <Route
          path="traspasos/:id"
          element={
            <SoloInterno>
              <TraspasoDetalle />
            </SoloInterno>
          }
        />
        <Route
          path="recetas"
          element={
            <SoloInterno>
              <Recetas />
            </SoloInterno>
          }
        />
        <Route
          path="proyecciones"
          element={
            <SoloInterno>
              <Proyecciones />
            </SoloInterno>
          }
        />
        <Route
          path="compras"
          element={
            <SoloInterno>
              <Compras />
            </SoloInterno>
          }
        />
        <Route
          path="gastos"
          element={
            <SoloInterno>
              <Gastos />
            </SoloInterno>
          }
        />
        <Route path="cuenta" element={<Cuenta />} />
        <Route
          path="facturacion"
          element={
            <RequiereRol roles={ROLES_ADMIN}>
              <Facturacion />
            </RequiereRol>
          }
        />
        <Route
          path="admin"
          element={
            <RequiereRol roles={ROLES_ADMIN}>
              <Administracion />
            </RequiereRol>
          }
        />
        {/* F2-147: el alta guiada es sólo de admin_global; la guía del agente, de cualquier admin. */}
        <Route
          path="admin/alta"
          element={
            <RequiereRol roles={['admin_global']}>
              <AltaGuiada />
            </RequiereRol>
          }
        />
        <Route
          path="ayuda/agente"
          element={
            <RequiereRol roles={ROLES_ADMIN}>
              <AyudaAgente />
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
