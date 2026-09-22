import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useUsuario } from '../auth/contexto';
import { useAlcance } from '../filtros/alcance';
import { queryVista } from '../filtros/vista';
import { Logo, Marca, NOMBRE_PRODUCTO } from '../marca/Marca';
import { sinReportar, UMBRAL_ALERTA_S } from '../paginas/admin/reglasAgentes';
import { useEstadoAgentes } from '../paginas/admin/consultas';
import { useConReloj } from '../paginas/mesas/consultas';
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
 * Tres anchos (F2-210):
 * - < md: cajón que se abre con ☰; cerrado queda fuera de pantalla e `invisible`, así no
 *   tapa el contenido ni recibe foco.
 * - md a lg: riel de iconos (`w-16`). Los textos se ocultan; el nombre accesible no cambia
 *   porque cada control lleva `aria-label`, y a la vista sale en su `title`. Sin barra de scroll
 *   visible (en 64 px se come el icono): se desplaza igual con rueda, toque y Tab.
 * - ≥ lg: lateral completo.
 */
// Sin `truncate`: un nombre largo ("Orquestador de menú") pasa de renglón, no se recorta.
const SOLO_TEXTO_ANCHO = 'min-w-0 md:hidden lg:block';

export function Sidebar({ abierto, onNavegar }: { abierto: boolean; onNavegar: () => void }) {
  const usuario = useUsuario();

  return (
    <aside
      id="menu-principal"
      className={`fixed inset-y-0 left-0 z-30 w-64 max-w-[80vw] overflow-y-auto border-r border-linea bg-superficie transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-16 md:max-w-none md:shrink-0 md:translate-x-0 md:[scrollbar-width:none] lg:w-64 lg:[scrollbar-width:auto] ${
        abierto ? 'translate-x-0' : '-translate-x-full max-md:invisible'
      }`}
    >
      <div className="flex h-14 items-center border-b border-linea px-4 md:justify-center md:px-0 lg:justify-start lg:px-4">
        <Marca className="md:hidden lg:inline-flex" />
        <span className="hidden text-acento-texto md:inline-flex lg:hidden" title={NOMBRE_PRODUCTO}>
          <Logo className="h-7 w-7" />
        </span>
      </div>
      {/* Remontar por usuario: el colapso recordado es de cada quien. */}
      <Menu key={usuario.id} onNavegar={onNavegar} />
    </aside>
  );
}

function Menu({ onNavegar }: { onNavegar: () => void }) {
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
    <nav aria-label="Principal" className="p-2">
      {secciones.map((seccion) => (
        <Seccion
          key={seccion.id}
          seccion={seccion}
          colapsada={colapsadas.includes(seccion.id)}
          onAlternar={() => alternar(seccion.id)}
          onNavegar={onNavegar}
        />
      ))}
    </nav>
  );
}

function Seccion({
  seccion,
  colapsada,
  onAlternar,
  onNavegar,
}: {
  seccion: SeccionMenu;
  colapsada: boolean;
  onAlternar: () => void;
  onNavegar: () => void;
}) {
  const [parametros] = useSearchParams();
  // Los enlaces conservan empresa, sucursal y periodo (F2-212): cambiar de vista no
  // pierde el filtro.
  const alcance = queryVista(parametros);
  const idLista = `menu-seccion-${seccion.id}`;
  const tieneAgentes = seccion.entradas.some((e) => e.id === 'administracion.agentes');

  return (
    <div className="mt-3 first:mt-0 md:border-t md:border-linea-suave md:pt-2 md:first:border-t-0 lg:border-t-0 lg:pt-0">
      <div className="relative flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!colapsada}
          aria-controls={idLista}
          aria-label={seccion.titulo}
          title={seccion.titulo}
          onClick={onAlternar}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-3 py-1 text-left text-xs font-semibold tracking-wide text-tinta-tenue uppercase hover:bg-realce md:justify-center md:px-0 lg:justify-start lg:px-3"
        >
          <span className={SOLO_TEXTO_ANCHO}>{seccion.titulo}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 transition-transform lg:ml-auto ${
              colapsada ? '-rotate-90' : ''
            }`}
          />
        </button>
        {/* Con Administración colapsada la alerta de agentes no se esconde: sube aquí. */}
        {tieneAgentes && colapsada && <AlertaAgentes search={alcance} onNavegar={onNavegar} />}
      </div>
      {/* `hidden` y sin hijos: lo colapsado no se ve ni entra en el orden de Tab. */}
      <ul id={idLista} hidden={colapsada} className="mt-1 space-y-1">
        {!colapsada &&
          seccion.entradas.map((entrada) => (
            <li key={entrada.id} className="relative flex flex-wrap items-center gap-1">
              {entrada.destino ? (
                <EnlaceEntrada entrada={entrada} alcance={alcance} onNavegar={onNavegar} />
              ) : (
                <EntradaPendiente entrada={entrada} />
              )}
              {entrada.id === 'administracion.agentes' && (
                <AlertaAgentes search={alcance} onNavegar={onNavegar} />
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

const CLASE_ENTRADA =
  'flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium md:justify-center md:px-0 lg:justify-start lg:px-3';

function EnlaceEntrada({
  entrada,
  alcance,
  onNavegar,
}: {
  entrada: EntradaMenu;
  alcance: string;
  onNavegar: () => void;
}) {
  const { pathname } = useLocation();
  const [parametros] = useSearchParams();
  const destino = entrada.destino!;
  const activa = entradaActiva(entrada, pathname, parametros);
  const Icono = entrada.icono;

  return (
    <Link
      to={{ pathname: destino.ruta, search: searchDestino(destino, alcance) }}
      onClick={onNavegar}
      aria-current={activa ? 'page' : undefined}
      aria-label={entrada.texto}
      title={entrada.texto}
      className={`${CLASE_ENTRADA} ${
        activa ? 'bg-acento text-sobre-acento' : 'text-tinta-medio hover:bg-realce'
      }`}
    >
      <Icono aria-hidden="true" className="h-4 w-4 shrink-0" />
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
function EntradaPendiente({ entrada }: { entrada: EntradaMenu }) {
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
        className={`peer ${CLASE_ENTRADA} cursor-not-allowed text-left text-tinta-tenue hover:bg-fondo`}
      >
        <Icono aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={SOLO_TEXTO_ANCHO}>{entrada.texto}</span>
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 rounded bg-realce px-1.5 text-[10px] font-semibold tracking-wide text-tinta-suave uppercase md:hidden lg:inline"
        >
          Pronto
        </span>
      </button>
      <span
        id={idRazon}
        className="hidden w-full px-3 pb-1 text-xs text-tinta-tenue lg:peer-focus-visible:block max-md:peer-focus-visible:block"
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
function AlertaAgentes({ search, onNavegar }: { search: string; onNavegar: () => void }) {
  const { empresa } = useAlcance();
  const consulta = useEstadoAgentes(empresa?.id);
  const { data, dataUpdatedAt } = consulta;
  // Sólo el CONTEO depende del reloj: el badge se vuelve a pintar cuando cambia, no
  // cada pulso (F1-094).
  const caidas = useConReloj((ahora) =>
    data === undefined ? 0 : sinReportar(data, dataUpdatedAt, ahora).length,
  );
  if (caidas === 0) return null;

  const destino = new URLSearchParams(search);
  destino.set('tab', 'agentes');
  const texto =
    caidas === 1
      ? `1 sucursal lleva más de ${UMBRAL_ALERTA_S / 60} min sin reportar`
      : `${caidas} sucursales llevan más de ${UMBRAL_ALERTA_S / 60} min sin reportar`;
  return (
    <Link
      to={{ pathname: '/admin', search: `?${destino.toString()}` }}
      onClick={onNavegar}
      aria-label={texto}
      title={texto}
      data-testid="alerta-agentes"
      className="shrink-0 rounded-full bg-peligro-fuerte px-2 py-0.5 text-xs font-semibold text-sobre-peligro md:absolute md:top-0 md:right-0 md:px-1.5 md:text-[10px] lg:static lg:px-2 lg:text-xs"
    >
      {caidas}
    </Link>
  );
}
