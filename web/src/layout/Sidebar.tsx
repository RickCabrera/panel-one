import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useUsuario } from '../auth/contexto';
import { queryVista } from '../filtros/vista';
import { Isotipo, Logotipo, NOMBRE_PRODUCTO } from '../marca/Marca';
import { textoAgentesCaidos, useAgentesCaidos } from './agentesCaidos';
import {
  entradaActiva,
  guardarColapsadas,
  leerColapsadas,
  searchDestino,
  seccionesPara,
  type EntradaMenu,
  type SeccionMenu,
} from './menu';

/*
 * Dos anchos (F2-210; UI-04 quitó el cajón del celular, que ahora es la barra inferior y la
 * hoja «Más»: el lateral sólo se monta desde `md`):
 * - md a lg: riel de iconos (`w-16`). Los textos se ocultan; el nombre accesible no cambia
 *   porque cada control lleva `aria-label`, y a la vista sale en su `title`. Sin barra de scroll
 *   visible (en 64 px se come el icono): se desplaza igual con rueda, toque y Tab.
 * - ≥ lg: lateral completo.
 */
// Sin `truncate`: un nombre largo ("Orquestador de menú") pasa de renglón, no se recorta.
const SOLO_TEXTO_ANCHO = 'min-w-0 hidden lg:block';

/*
 * UI-02: el lateral es SIEMPRE del morado de marca (tokens `lateral-*`), en los dos temas: es
 * donde vive el logo arena. El foco va en arena (el violeta del acento no se ve sobre morado).
 */
const FOCO_LATERAL =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-arena';

export function Sidebar() {
  const usuario = useUsuario();

  return (
    <aside
      id="menu-principal"
      // El ancho suma el área segura izquierda (teléfono en horizontal con `viewport-fit=cover`):
      // el riel y el lateral conservan su espacio y la muesca cae en el relleno.
      className="print:hidden sticky top-0 h-screen w-[calc(4rem+env(safe-area-inset-left))] shrink-0 overflow-y-auto pl-[env(safe-area-inset-left)] lg:w-[calc(15rem+env(safe-area-inset-left))] border-r border-lateral-borde bg-lateral text-lateral-tinta [scrollbar-color:var(--lateral-borde)_transparent] [scrollbar-width:none] lg:[scrollbar-width:thin]"
    >
      <div className="flex h-16 items-center px-5 md:justify-center md:px-0 lg:justify-start lg:px-5">
        <span className="md:hidden lg:block">
          <Logotipo variante="oscuro" className="h-8" />
        </span>
        <span className="hidden md:block lg:hidden" title={NOMBRE_PRODUCTO}>
          <Isotipo variante="oscuro" className="h-8 w-8" decorativo={false} />
        </span>
      </div>
      {/* Remontar por usuario: el colapso recordado es de cada quien. */}
      <Menu key={usuario.id} />
    </aside>
  );
}

function Menu() {
  const usuario = useUsuario();
  const [colapsadas, setColapsadas] = useState(() => leerColapsadas(usuario.id));
  const secciones = seccionesPara(usuario.rol);

  function alternar(id: string) {
    const nuevas = colapsadas.includes(id)
      ? colapsadas.filter((c) => c !== id)
      : [...colapsadas, id];
    setColapsadas(nuevas);
    guardarColapsadas(usuario.id, nuevas);
  }

  return (
    <nav aria-label="Principal" className="px-2 pt-1 pb-4">
      {secciones.map((seccion) => (
        <Seccion
          key={seccion.id}
          seccion={seccion}
          colapsada={colapsadas.includes(seccion.id)}
          onAlternar={() => alternar(seccion.id)}
        />
      ))}
    </nav>
  );
}

function Seccion({
  seccion,
  colapsada,
  onAlternar,
}: {
  seccion: SeccionMenu;
  colapsada: boolean;
  onAlternar: () => void;
}) {
  const [parametros] = useSearchParams();
  // Los enlaces conservan empresa, sucursal y periodo (F2-212): cambiar de vista no
  // pierde el filtro.
  const alcance = queryVista(parametros);
  const idLista = `menu-seccion-${seccion.id}`;
  const tieneAgentes = seccion.entradas.some((e) => e.id === 'administracion.agentes');

  return (
    <div className="mt-4 first:mt-0 md:border-t md:border-lateral-borde md:pt-2 md:first:border-t-0 lg:border-t-0 lg:pt-0">
      <div className="relative flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!colapsada}
          aria-controls={idLista}
          aria-label={seccion.titulo}
          title={seccion.titulo}
          onClick={onAlternar}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-2.5 py-1 text-left text-xs font-semibold text-lateral-tenue hover:bg-lateral-realce hover:text-lateral-tinta md:justify-center md:px-0 lg:justify-start lg:px-2.5 ${FOCO_LATERAL}`}
        >
          <span className={SOLO_TEXTO_ANCHO}>{seccion.titulo}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 opacity-70 transition-transform lg:ml-auto ${
              colapsada ? '-rotate-90' : ''
            }`}
          />
        </button>
        {/* Con Administración colapsada la alerta de agentes no se esconde: sube aquí. */}
        {tieneAgentes && colapsada && <AlertaAgentes search={alcance} />}
      </div>
      {/* `hidden` y sin hijos: lo colapsado no se ve ni entra en el orden de Tab. */}
      <ul id={idLista} hidden={colapsada} className="mt-0.5 space-y-px">
        {!colapsada &&
          seccion.entradas.map((entrada) => (
            <li key={entrada.id} className="relative flex flex-wrap items-center gap-1">
              {entrada.destino ? (
                <EnlaceEntrada entrada={entrada} alcance={alcance} />
              ) : (
                <EntradaPendiente entrada={entrada} />
              )}
              {entrada.id === 'administracion.agentes' && <AlertaAgentes search={alcance} />}
            </li>
          ))}
      </ul>
    </div>
  );
}

const CLASE_ENTRADA = `relative flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium md:justify-center md:px-0 md:py-2 lg:justify-start lg:px-2.5 lg:py-1.5 ${FOCO_LATERAL}`;

function EnlaceEntrada({ entrada, alcance }: { entrada: EntradaMenu; alcance: string }) {
  const { pathname } = useLocation();
  const [parametros] = useSearchParams();
  const destino = entrada.destino!;
  const activa = entradaActiva(entrada, pathname, parametros);
  const Icono = entrada.icono;

  return (
    <Link
      to={{ pathname: destino.ruta, search: searchDestino(destino, alcance) }}
      aria-current={activa ? 'page' : undefined}
      aria-label={entrada.texto}
      title={entrada.texto}
      className={`${CLASE_ENTRADA} ${
        // Activa: el relleno del acento y una muesca arena a la izquierda (el violeta solo
        // casi no se distingue del morado del lateral; la muesca sí).
        activa
          ? 'bg-acento text-sobre-acento shadow-sm before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-r-full before:bg-arena'
          : 'text-lateral-tinta hover:bg-lateral-realce'
      }`}
    >
      <Icono aria-hidden="true" className="h-4 w-4 shrink-0 opacity-90" />
      <span className={SOLO_TEXTO_ANCHO}>{entrada.texto}</span>
    </Link>
  );
}

/**
 * Módulo que todavía no existe: se ve (el menú es el mapa del producto) pero no navega a
 * una pantalla rota. Es un botón con `aria-disabled` y no `disabled` para que siga en el
 * orden de Tab: su razón se lee con el lector de pantalla (`aria-describedby`), sale al
 * pasar el cursor (`title`) y, con el lateral completo, debajo al enfocarlo con teclado.
 */
export function EntradaPendiente({ entrada }: { entrada: EntradaMenu }) {
  const pendiente = entrada.pendiente!;
  const idRazon = `razon-${entrada.id.replace('.', '-')}`;
  const Icono = entrada.icono;

  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={idRazon}
        aria-label={entrada.texto}
        title={`${entrada.texto}: ${pendiente.razon}`}
        className={`peer ${CLASE_ENTRADA} cursor-not-allowed text-left text-lateral-tenue`}
      >
        <Icono aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={SOLO_TEXTO_ANCHO}>{entrada.texto}</span>
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 rounded bg-lateral-realce px-1.5 text-[10px] font-semibold text-lateral-tenue md:hidden lg:inline"
        >
          Pronto
        </span>
      </button>
      <span
        id={idRazon}
        className="hidden w-full px-2.5 pb-1 text-xs text-lateral-tenue lg:peer-focus-visible:block max-md:peer-focus-visible:block"
      >
        {pendiente.razon}
      </span>
    </>
  );
}

/**
 * Badge de F1-061: cuántas sucursales de la empresa del selector llevan más de 10 min
 * sin reportar. Sólo se monta para admins (el visor ni siquiera hace la petición) y
 * comparte la consulta con la pestaña Agentes. Enlaza a esa pestaña conservando el
 * alcance.
 */
function AlertaAgentes({ search }: { search: string }) {
  const caidas = useAgentesCaidos();
  if (caidas === 0) return null;

  const destino = new URLSearchParams(search);
  destino.set('tab', 'agentes');
  const texto = textoAgentesCaidos(caidas);
  return (
    <Link
      to={{ pathname: '/admin', search: `?${destino.toString()}` }}
      aria-label={texto}
      title={texto}
      data-testid="alerta-agentes"
      className={`shrink-0 rounded-full bg-peligro-fuerte px-2 py-0.5 text-xs font-semibold text-sobre-peligro md:absolute md:top-0 md:right-0 md:px-1.5 md:text-[10px] lg:static lg:px-2 lg:text-xs ${FOCO_LATERAL}`}
    >
      {caidas}
    </Link>
  );
}
