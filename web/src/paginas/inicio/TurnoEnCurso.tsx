import { Clock3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import { aCentavos, formatearPesos, pesos } from '../../dinero/dinero';
import { useCortesEnCurso, useTiempoRealCortes } from '../cortes/consultas';
import {
  duracionTurno,
  momento,
  nombreCorte,
  PARAM_TURNO,
  RUTA_TURNOS,
  VISTA_ABIERTOS,
  PARAM_VISTA,
} from '../cortes/reglas';
import { useAhora } from '../mesas/consultas';
import { CifraAnimada } from './CifraAnimada';
import type { Filtro } from './consultas';
import { Latido } from './Sparkline';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './Tarjeta';

/**
 * "Turno en curso" del Panel (MVP): lo cobrado en el turno abierto de SR de cada sucursal (el
 * acumulado del corte que todavía no se hace), con liga a su detalle en Turnos. No depende del
 * periodo elegido: es el dato vivo, como "Venta en vivo".
 */
export function TarjetaTurnoEnCurso({
  filtro,
  className = '',
}: {
  filtro: Filtro | null;
  className?: string;
}) {
  useTiempoRealCortes(filtro);
  const consulta = useCortesEnCurso(filtro);
  const [parametros] = useSearchParams();
  const ahora = useAhora();
  // A "Abiertos ahora" de Turnos (UI-01), con el turno elegido en el detalle.
  const enlace = (id: string) => {
    const p = new URLSearchParams();
    for (const llave of ['empresa', 'sucursal']) {
      const valor = parametros.get(llave);
      if (valor !== null) p.set(llave, valor);
    }
    p.set(PARAM_VISTA, VISTA_ABIERTOS);
    p.set(PARAM_TURNO, id);
    return `${RUTA_TURNOS}?${p.toString()}`;
  };
  return (
    <Tarjeta titulo="Turno en curso" icono={Clock3} className={className}>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto />}>
        {(turnos) =>
          turnos.length === 0 ? (
            <Vacio>
              No hay un turno abierto en SoftRestaurant (o el agente no lo ha reportado).
            </Vacio>
          ) : (
            <ul className="divide-y divide-linea-suave" data-testid="turnos-en-curso">
              {turnos.map((t) => (
                <li key={t.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <p
                      className="truncate text-3xl font-semibold tracking-tight tabular-nums text-tinta"
                      data-testid="turno-venta"
                    >
                      <CifraAnimada
                        valor={aCentavos(t.venta)}
                        formato={formatearPesos}
                        sinValor={pesos(t.venta)}
                      />
                    </p>
                    <Latido color="bg-acento-borde" />
                  </div>
                  <p className="mt-1 text-sm text-tinta-medio">
                    {t.cuentas} cuenta{t.cuentas === 1 ? '' : 's'} cobrada
                    {t.cuentas === 1 ? '' : 's'} · {nombreCorte(t)} · {t.sucursal}
                  </p>
                  <p className="mt-0.5 text-xs text-tinta-tenue">
                    Abrió {momento(t.zonaHoraria, t.aperturaAt)} (hace{' '}
                    {duracionTurno(t.aperturaAt, null, ahora)}) ·{' '}
                    <Link
                      to={enlace(t.id)}
                      className="font-medium text-acento-texto underline-offset-2 hover:underline"
                    >
                      Ver turno
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}
