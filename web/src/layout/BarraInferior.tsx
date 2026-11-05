import { Ellipsis, LayoutPanelTop, LogOut, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useAuth, useUsuario } from '../auth/contexto';
import { NOMBRE_ROL, ROLES_ADMIN } from '../auth/roles';
import { queryVista } from '../filtros/vista';
import { InterruptorEstilo } from '../tema/InterruptorEstilo';
import { InterruptorTema } from '../tema/InterruptorTema';
import { textoAgentesCaidos, useAgentesCaidos } from './agentesCaidos';
import { HojaInferior } from './HojaInferior';
import { iniciales } from './iniciales';
import {
  barraMovilPara,
  entradaActiva,
  searchDestino,
  seccionesMasPara,
  type EntradaMenu,
} from './menu';

/*
 * UI-04: la navegación del celular. Cuatro destinos de `menu.ts` (`movil.barra`) y «Más», que
 * abre una hoja con el resto del menú (las mismas secciones y los mismos permisos) y las
 * acciones de cuenta. Es del color del lateral en los dos temas (morado en «Clásico»; vidrio negro
 * en «Noche», UI-06): el ítem activo
 * lleva el relleno violeta del acento y una muesca arena arriba (el violeta solo casi no se
 * distingue sobre morado). Cada destino mide ≥ 56 px de alto y 1/5 del ancho; el relleno de
 * abajo es `env(safe-area-inset-bottom)` (la barra de gestos del WebView y del iPhone).
 */

/** Alto de la barra sin el área segura; `Layout` deja ese espacio (4 rem) bajo el contenido. */
const ALTO_BARRA = 'h-16';

const FOCO_LATERAL =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-arena';

const CLASE_DESTINO = `relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium leading-tight ${FOCO_LATERAL}`;

function Pastilla({ activa, children }: { activa: boolean; children: ReactNode }) {
  return (
    <>
      {activa && (
        <span
          aria-hidden="true"
          className="absolute top-0 left-1/2 h-1 w-8 -translate-x-1/2 rounded-b-full bg-arena"
        />
      )}
      <span
        aria-hidden="true"
        className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
          activa ? 'bg-acento text-sobre-acento' : ''
        }`}
      >
        {children}
      </span>
    </>
  );
}

export function BarraInferior() {
  const usuario = useUsuario();
  const location = useLocation();
  const [parametros] = useSearchParams();
  const alcance = queryVista(parametros);
  // La hoja se abre «en» una ubicación: si la ruta cambia (un enlace, el botón atrás), queda
  // cerrada sola, sin un efecto que la persiga.
  const [abiertaEn, setAbiertaEn] = useState<string | null>(null);
  const abierta = abiertaEn === location.key;
  const destinos = barraMovilPara(usuario.rol);
  const enBarra = destinos.some((e) => entradaActiva(e, location.pathname, parametros));
  // F1-061 en el celular: sólo para admins (el visor ni siquiera pide el estado de agentes).
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);

  return (
    <>
      <nav
        aria-label="Principal"
        className="print:hidden fixed inset-x-0 bottom-0 z-30 border-t border-lateral-borde bg-lateral vidrio-barra pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-lateral-tinta"
      >
        <ul className={`mx-auto flex max-w-xl items-stretch ${ALTO_BARRA}`}>
          {destinos.map((entrada) => (
            <li key={entrada.id} className="flex min-w-0 flex-1">
              <DestinoBarra entrada={entrada} alcance={alcance} />
            </li>
          ))}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={abierta}
              aria-controls={ID_HOJA_MAS}
              aria-describedby={esAdmin ? ID_AVISO_MAS : undefined}
              onClick={() => setAbiertaEn(location.key)}
              className={`${CLASE_DESTINO} ${!enBarra ? 'text-lateral-tinta' : 'text-lateral-tenue'}`}
            >
              {/* Fuera de los cuatro destinos (Resumen, Análisis...), «Más» es donde estás. */}
              <Pastilla activa={!enBarra}>
                <Ellipsis className="h-5 w-5" />
              </Pastilla>
              <span>Más</span>
              {esAdmin && <PuntoAgentes />}
            </button>
            {/* Fuera del botón: dentro, el texto se sumaría a su nombre («Más»). */}
            {esAdmin && <DescripcionAgentes id={ID_AVISO_MAS} />}
          </li>
        </ul>
      </nav>
      {abierta && <HojaMas alcance={alcance} onCerrar={() => setAbiertaEn(null)} />}
    </>
  );
}

function DestinoBarra({ entrada, alcance }: { entrada: EntradaMenu; alcance: string }) {
  const { pathname } = useLocation();
  const [parametros] = useSearchParams();
  const destino = entrada.destino!;
  const activa = entradaActiva(entrada, pathname, parametros);
  const Icono = entrada.icono;
  return (
    <Link
      to={{ pathname: destino.ruta, search: searchDestino(destino, alcance) }}
      aria-current={activa ? 'page' : undefined}
      // El nombre accesible es el del menú completo («Monitor de mesas»): el mismo que en
      // escritorio, aunque a la vista diga «Mesas».
      aria-label={entrada.texto}
      className={`${CLASE_DESTINO} ${activa ? 'text-lateral-tinta' : 'text-lateral-tenue'}`}
    >
      <Pastilla activa={activa}>
        <Icono className="h-5 w-5" />
      </Pastilla>
      <span aria-hidden="true" className="max-w-full truncate">
        {entrada.movil!.corto}
      </span>
    </Link>
  );
}

const ID_HOJA_MAS = 'hoja-mas';
const ID_AVISO_MAS = 'aviso-mas-agentes';
const ID_AVISO_AGENTES = 'aviso-hoja-agentes';

/** Punto rojo sobre «Más» cuando alguna sucursal lleva más de 10 min sin reportar. */
function PuntoAgentes() {
  const caidas = useAgentesCaidos();
  if (caidas === 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="aviso-mas-agentes"
      className="absolute top-1.5 left-1/2 ml-3 h-2.5 w-2.5 rounded-full bg-peligro-fuerte ring-2 ring-lateral"
    />
  );
}

/** El mismo aviso en palabras, para `aria-describedby` (vacío si todo reporta). */
function DescripcionAgentes({ id }: { id: string }) {
  const caidas = useAgentesCaidos();
  return (
    <span id={id} className="sr-only">
      {caidas > 0 ? textoAgentesCaidos(caidas) : ''}
    </span>
  );
}

/** El conteo junto a «Agentes» en la hoja (el badge del lateral, F1-061). */
function ConteoAgentes() {
  const caidas = useAgentesCaidos();
  if (caidas === 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="alerta-agentes"
      className="ml-auto shrink-0 rounded-full bg-peligro-fuerte px-2 py-0.5 text-xs font-semibold text-sobre-peligro"
    >
      {caidas}
    </span>
  );
}

const CLASE_FILA =
  'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-base font-medium';

function HojaMas({ alcance, onCerrar }: { alcance: string; onCerrar: () => void }) {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();
  const { pathname } = useLocation();
  const [parametros] = useSearchParams();
  const [saliendo, setSaliendo] = useState(false);
  const secciones = seccionesMasPara(usuario.rol);

  return (
    <HojaInferior id={ID_HOJA_MAS} titulo="Más" onCerrar={onCerrar}>
      <nav aria-label="Más secciones" className="space-y-4 pb-2">
        {secciones.map((seccion) => (
          <section key={seccion.id} aria-labelledby={`mas-${seccion.id}`}>
            <h3
              id={`mas-${seccion.id}`}
              className="px-1 pb-1.5 text-xs font-semibold text-tinta-tenue"
            >
              {seccion.titulo}
            </h3>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {seccion.entradas.map((entrada) => {
                // `seccionesMasPara` ya dejó sólo entradas con destino; esto sólo estrecha el tipo.
                const destino = entrada.destino;
                if (!destino) return null;
                const esAgentes = entrada.id === 'administracion.agentes';
                const activa = entradaActiva(entrada, pathname, parametros);
                const Icono = entrada.icono;
                return (
                  <li key={entrada.id} className="min-w-0">
                    <Link
                      to={{ pathname: destino.ruta, search: searchDestino(destino, alcance) }}
                      onClick={onCerrar}
                      aria-current={activa ? 'page' : undefined}
                      aria-describedby={esAgentes ? ID_AVISO_AGENTES : undefined}
                      className={`flex min-h-12 min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                        activa
                          ? 'bg-acento text-sobre-acento shadow-xs'
                          : 'bg-realce text-tinta hover:bg-realce-fuerte'
                      }`}
                    >
                      <Icono aria-hidden="true" className="h-4.5 w-4.5 shrink-0 opacity-90" />
                      <span className="min-w-0 leading-snug">{entrada.texto}</span>
                      {esAgentes && <ConteoAgentes />}
                    </Link>
                    {esAgentes && <DescripcionAgentes id={ID_AVISO_AGENTES} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      <section aria-labelledby="mas-cuenta" className="mt-4 border-t border-linea pt-4">
        <h3 id="mas-cuenta" className="sr-only">
          Cuenta
        </h3>
        <div className="flex items-center gap-3 px-1">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-arena font-titulo text-sm font-semibold text-lateral"
          >
            {iniciales(usuario.nombre)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-medium">{usuario.nombre}</div>
            <div className="truncate text-xs text-tinta-tenue">{NOMBRE_ROL[usuario.rol]}</div>
          </div>
          <InterruptorTema amplio />
        </div>
        {/* UI-06: el estilo de la marca, junto al tema. */}
        <div className="mt-3 flex items-center justify-between gap-3 px-1">
          <span className="text-sm font-medium text-tinta-suave">Estilo</span>
          <InterruptorEstilo amplio />
        </div>
        <ul className="mt-3 space-y-0.5">
          <li>
            <Link
              to={{ pathname: '/cuenta', search: alcance }}
              onClick={onCerrar}
              className={`${CLASE_FILA} hover:bg-realce`}
            >
              <UserRound aria-hidden="true" className="h-5 w-5 text-tinta-suave" />
              Mi cuenta
            </Link>
          </li>
          {usuario.rol === 'admin_global' && (
            <li>
              <Link to="/plataforma" onClick={onCerrar} className={`${CLASE_FILA} hover:bg-realce`}>
                <LayoutPanelTop aria-hidden="true" className="h-5 w-5 text-tinta-suave" />
                Plataforma
              </Link>
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={() => {
                setSaliendo(true);
                void cerrarSesion();
              }}
              disabled={saliendo}
              className={`${CLASE_FILA} text-peligro hover:bg-peligro-fondo disabled:opacity-60`}
            >
              <LogOut aria-hidden="true" className="h-5 w-5" />
              Salir
            </button>
          </li>
        </ul>
      </section>
    </HojaInferior>
  );
}
