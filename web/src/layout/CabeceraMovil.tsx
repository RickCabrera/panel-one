import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router';

import { SelectorAlcance } from '../filtros/SelectorAlcance';
import { useAlcance } from '../filtros/alcance';
import { usaPeriodo } from '../filtros/vista';
import { Isotipo } from '../marca/Marca';
import { useTema } from '../tema/contexto';
import { Campana } from './Campana';
import { HojaInferior } from './HojaInferior';
import { OperacionEnVivo } from './OperacionEnVivo';
import { PeriodoGlobal } from './PeriodoGlobal';

/**
 * UI-04: la cabecera del celular. Un renglón: el isotipo, la empresa y la sucursal (un botón
 * que abre una hoja con los dos selectores), la operación en vivo y la campana. Tema, cuenta y
 * salir viven en «Más» (`BarraInferior`). Debajo, fuera de lo fijo para no comerse la
 * pantalla, el periodo de las vistas que lo usan.
 */
export function CabeceraMovil() {
  const { pathname } = useLocation();
  // UI-06: en «Noche» la cabecera y la franja del periodo son negras en los dos temas (ver Topbar).
  const { estilo, zonaOscura } = useTema();
  return (
    <>
      <header
        style={zonaOscura}
        className="print:hidden sticky top-0 z-20 border-b border-linea bg-superficie/95 pt-[env(safe-area-inset-top)] text-tinta backdrop-blur vidrio-barra"
      >
        <div className="flex h-14 min-w-0 items-center gap-2.5 px-4">
          <Isotipo variante={estilo === 'noche' ? 'oscuro' : 'auto'} className="h-8 w-8 shrink-0" />
          <BotonAlcance />
          <OperacionEnVivo compacto />
          <Campana />
        </div>
      </header>
      {usaPeriodo(pathname) && (
        <div
          style={zonaOscura}
          className="print:hidden min-w-0 border-b border-linea-suave bg-superficie px-4 py-2 text-tinta vidrio-barra"
        >
          <PeriodoGlobal />
        </div>
      )}
    </>
  );
}

function BotonAlcance() {
  const { empresa, sucursal, empresas } = useAlcance();
  const [abierta, setAbierta] = useState(false);

  const nombreEmpresa = empresas.isPending
    ? 'Cargando…'
    : (empresa?.nombre ?? (empresas.isError ? 'Sin empresas' : 'Elige una empresa'));
  const nombreSucursal = sucursal?.nombre ?? 'Todas las sucursales';

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierta}
        aria-label={`Empresa y sucursal: ${nombreEmpresa}, ${nombreSucursal}`}
        onClick={() => setAbierta(true)}
        className="-mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-lg px-1 text-left hover:bg-realce"
      >
        <span aria-hidden="true" className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">{nombreEmpresa}</span>
          <span className="block truncate text-xs text-tinta-tenue">{nombreSucursal}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-tinta-suave" />
      </button>
      {abierta && (
        <HojaInferior titulo="Empresa y sucursal" onCerrar={() => setAbierta(false)}>
          <div className="pt-1 pb-2">
            <SelectorAlcance amplio />
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="mt-4 h-11 w-full rounded-lg bg-acento text-base font-semibold text-sobre-acento shadow-xs hover:brightness-110"
            >
              Listo
            </button>
          </div>
        </HojaInferior>
      )}
    </>
  );
}
