import { useAlcance } from '../filtros/alcance';
import { sinReportar, UMBRAL_ALERTA_S } from '../paginas/admin/reglasAgentes';
import { useEstadoAgentes } from '../paginas/admin/consultas';
import { useConReloj } from '../paginas/mesas/consultas';

/**
 * F1-061: cuántas sucursales de la empresa del selector llevan más de 10 min sin reportar.
 * Comparte la consulta con la pestaña Agentes. Sólo se llama desde componentes que se montan
 * para admins: el visor ni siquiera hace la petición. Sólo el CONTEO depende del reloj, así
 * que quien lo usa se vuelve a pintar cuando cambia, no cada pulso (F1-094).
 *
 * UI-04: lo usan el lateral (badge junto a Agentes) y el celular (badge en la hoja «Más» y
 * aviso en el botón «Más»).
 */
export function useAgentesCaidos(): number {
  const { empresa } = useAlcance();
  const { data, dataUpdatedAt } = useEstadoAgentes(empresa?.id);
  return useConReloj((ahora) =>
    data === undefined ? 0 : sinReportar(data, dataUpdatedAt, ahora).length,
  );
}

/** «1 sucursal lleva…» / «N sucursales llevan…»: el texto del badge y de su nombre accesible. */
export function textoAgentesCaidos(caidas: number): string {
  return caidas === 1
    ? `1 sucursal lleva más de ${UMBRAL_ALERTA_S / 60} min sin reportar`
    : `${caidas} sucursales llevan más de ${UMBRAL_ALERTA_S / 60} min sin reportar`;
}
