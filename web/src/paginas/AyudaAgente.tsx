import { Link, useSearchParams } from 'react-router';

import { queryVista } from '../filtros/vista';
import { Tarjeta } from './inicio/Tarjeta';
import { Vista } from './Vista';

/**
 * La guía corta de instalación del agente (F2-147), para quien acaba de dar de alta una empresa.
 * Resume `docs/instalacion-agente.md` (la guía completa, con la tabla de fallas y el checklist de
 * red): si cambia el instalador, se cambian las dos.
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
        leer. Toma unos 15 minutos por sucursal.
      </p>
      <Tarjeta titulo="Los pasos">
        <ol className="list-decimal space-y-3 pl-5 text-sm" data-testid="ayuda-agente">
          <li>
            <strong>Ten a la mano</strong> la PC del SQL Server de SoftRestaurant (casi siempre la
            caja principal), un usuario de Windows administrador, la carpeta del instalador (un
            <code> .zip</code>: clic derecho › Propiedades › Desbloquear, y luego Extraer todo) y la
            dirección de este panel.
          </li>
          <li>
            <strong>La API key de la sucursal.</strong> La del alta guiada, o una nueva en{' '}
            <Link
              className="text-acento-texto underline"
              to={{ pathname: '/admin', search: conTab('sucursales') }}
            >
              Administración › Sucursales
            </Link>
            . Se muestra una sola vez; si se pierde, se genera otra y la anterior deja de servir. No
            la mandes por WhatsApp ni por correo.
          </li>
          <li>
            <strong>Abre PowerShell como administrador</strong> (Inicio › escribe PowerShell › clic
            derecho › Ejecutar como administrador) y entra a la carpeta del instalador.
          </li>
          <li>
            <strong>Crea el usuario de solo lectura:</strong>{' '}
            <code className="break-all">
              powershell -NoProfile -ExecutionPolicy Bypass -File .\crear-usuario-lector.ps1
            </code>
            . Elige una contraseña de 12 a 64 caracteres (letras sin acento, números y{' '}
            <code>- _ . ! @ # * + = ?</code>) y anótala. Tiene que terminar en{' '}
            <em>LISTO: monitor_lector sólo puede leer</em>.
          </li>
          <li>
            <strong>Instala el agente:</strong>{' '}
            <code className="break-all">
              powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1
            </code>
            . Te pide la dirección del panel, la API key, el servidor y la base de SoftRestaurant y
            la contraseña del paso anterior. Nunca las escribas en la línea del comando.
          </li>
          <li>
            <strong>Lee el resultado:</strong> tiene que decir <em>Resultado: OK</em> y terminar en{' '}
            <em>LISTO</em>. Si algo dice <em>[FALLA]</em>, la línea de abajo dice qué revisar; para
            volver a escribir los datos, corre el instalador con <code>-ReemplazarConfig</code>.
          </li>
          <li>
            <strong>Confirma en el panel:</strong> en{' '}
            <Link
              className="text-acento-texto underline"
              to={{ pathname: '/admin', search: conTab('agentes') }}
            >
              Administración › Agentes
            </Link>{' '}
            la sucursal tiene que decir <em>Conectado</em> en menos de un minuto, y la lista de
            arranque de Inicio marca el paso del agente.
          </li>
        </ol>
      </Tarjeta>
      <p className="mt-4 max-w-3xl text-sm text-tinta-tenue">
        Si el SQL Server sólo acepta usuarios de Windows, o el usuario ya existía con más permisos
        que leer, el instalador se detiene sin cambiar nada: no lo fuerces, llama a soporte. La caja
        no debe dejar de cobrar por instalar el agente.
      </p>
    </Vista>
  );
}
