import { useEffect } from 'react';
import { Outlet } from 'react-router';

import { useNormalizarAlcance } from '../filtros/alcance';
import { renovarEsteDispositivo } from '../pwa/push';
import { AvisoMembresia } from './AvisoMembresia';
import { BarraInferior } from './BarraInferior';
import { CabeceraMovil } from './CabeceraMovil';
import { Sidebar } from './Sidebar';
import { SinConexion } from './SinConexion';
import { Topbar } from './Topbar';
import { useEsMovil } from './useEsMovil';

/**
 * UI-04: dos armazones con el mismo contenido. En el celular (< md), cabecera compacta arriba
 * y barra de navegación abajo; el `main` deja libre el alto de la barra más el área segura
 * para que la barra no tape la última fila. Desde md, el lateral y la cabecera de siempre.
 *
 * Con `viewport-fit=cover`, un teléfono en horizontal (≥ 768 px muchas veces) pone la muesca
 * o la barra de gestos a los lados: los dos armazones dejan `env(safe-area-inset-left/right)`
 * (en el de escritorio, la izquierda la absorbe el lateral).
 */
export function Layout() {
  const esMovil = useEsMovil();
  useNormalizarAlcance();

  // F2-146: con sesión, este navegador renueva su registro de avisos push (si lo tiene).
  // Un navegador que no abre el panel en 7 días deja de recibirlos.
  useEffect(() => {
    void renovarEsteDispositivo();
  }, []);

  if (esMovil) {
    return (
      <div
        data-armazon="movil"
        className="min-h-screen bg-fondo pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-tinta"
      >
        <CabeceraMovil />
        <SinConexion />
        <AvisoMembresia />
        <main className="min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] print:pb-0">
          <Outlet />
        </main>
        <BarraInferior />
      </div>
    );
  }

  return (
    <div
      data-armazon="escritorio"
      className="flex min-h-screen bg-fondo pr-[env(safe-area-inset-right)] text-tinta"
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <SinConexion />
        <AvisoMembresia />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
