import { Link, useSearchParams } from 'react-router';

import { queryVista } from '../filtros/vista';
import { URL_INSTALADOR } from './admin/reglasEnlace';
import { Tarjeta } from './inicio/Tarjeta';
import { Vista } from './Vista';

/**
 * La guía corta de instalación del agente (F2-147), para quien acaba de dar de alta una empresa.
 * Resume `docs/instalacion-agente.md` (la guía completa, con la tabla de fallas, el checklist de
 * red y la instalación avanzada): si cambia el instalador, se cambian las dos.
 */
export function AyudaAgente() {
  const [parametros] = useSearchParams();
  const conTab = (tab: string) => {
    const p = new URLSearchParams(queryVista(parametros));
    p.set('tab', tab);
    return `?${p.toString()}`;
  };
  return (
    <Vista titulo="Cómo se instala el agente">
      <p className="mb-4 max-w-3xl text-sm text-tinta-medio">
        El agente es un servicio de Windows que se instala en la PC donde está el SQL Server de
        SoftRestaurant. Cada 30 segundos <strong>lee</strong> la base del POS y manda los datos al
        panel. <strong>Nunca escribe en SoftRestaurant</strong>: entra con un usuario que sólo puede
        leer, y el instalador lo crea solo. Toma unos 5 minutos por sucursal y sólo hay que escribir
        un dato.
      </p>
      <Tarjeta titulo="Los 3 pasos">
        <ol className="list-decimal space-y-3 pl-5 text-sm" data-testid="ayuda-agente">
          <li>
            <strong>Genera el código de la sucursal</strong> en{' '}
            <Link
              className="text-acento-texto underline"
              to={{ pathname: '/admin', search: conTab('sucursales') }}
            >
              Administración › Sucursales
            </Link>{' '}
            › <em>Conectar sucursal</em>. Es un código como <code>K7P-42X</code>: sirve una sola vez
            y vence en 30 minutos.
          </li>
          <li>
            <strong>En la PC del SQL Server de SoftRestaurant</strong> (casi siempre la caja
            principal), descarga el instalador
            {URL_INSTALADOR ? (
              <>
                {' '}
                (
                <a className="text-acento-texto underline" href={URL_INSTALADOR}>
                  Instalar-YoControlo.zip
                </a>
                )
              </>
            ) : (
              <> (pídele a soporte el archivo Instalar-YoControlo.zip)</>
            )}
            , extráelo (clic derecho › Extraer todo) y da <strong>doble clic</strong> en{' '}
            <em>Instalar-YoControlo</em>. Acepta cuando Windows pregunte si permites cambios.
          </li>
          <li>
            <strong>Escribe el código</strong> cuando lo pida. Al final dice <em>LISTO</em>, y en{' '}
            <Link
              className="text-acento-texto underline"
              to={{ pathname: '/admin', search: conTab('agentes') }}
            >
              Administración › Agentes
            </Link>{' '}
            la sucursal dice <em>Conectado</em> en menos de un minuto. La lista de arranque de
            Inicio marca el paso del agente.
          </li>
        </ol>
      </Tarjeta>
      <p className="mt-4 max-w-3xl text-sm text-tinta-tenue">
        Si algo falla, el instalador dice qué pasó y qué hacer. Si el SQL Server sólo acepta
        usuarios de Windows, o el usuario de solo lectura ya existía con más permisos, se detiene
        sin cambiar nada: no lo fuerces, llama a soporte. La caja no debe dejar de cobrar por
        instalar el agente. Para soporte sigue existiendo la instalación avanzada (manual, con la
        API key): está en la guía completa.
      </p>
    </Vista>
  );
}
