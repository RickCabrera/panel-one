import { SelectorPeriodo } from '../filtros/SelectorPeriodo';
import { usePeriodo } from '../filtros/usePeriodo';

/** El único selector de periodo del panel (F2-212); lo leen todas las vistas con periodo. */
export function PeriodoGlobal() {
  const { periodo, rango, cambiarPeriodo } = usePeriodo();
  return <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />;
}
