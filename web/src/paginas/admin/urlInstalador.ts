import { useSistema } from '../../sistema/sistema';
import { leerUrlInstalador, URL_INSTALADOR } from './reglasEnlace';

/**
 * INST-02: de dónde se baja `Instalar-YoControlo.zip`. Primero la que dice el servidor
 * (`GET /sistema` › `descargaAgente`, que sale de `AGENTE_URL_DESCARGA`): se cambia en Railway
 * sin reconstruir el web. Si la API no la manda (vieja o sin configurar), la del build
 * (`VITE_URL_INSTALADOR_AGENTE`). Sólo `https://`; si no hay ninguna, null y la interfaz dice
 * que la pidan a soporte.
 */
export function useUrlInstalador(): string | null {
  const { data } = useSistema();
  return leerUrlInstalador(data?.descargaAgente ?? undefined) ?? URL_INSTALADOR;
}
