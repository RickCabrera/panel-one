import { formatearPesos, pesos } from '../../dinero/dinero';
import { horaEn } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from '../inicio/Tarjeta';
import { useAhora } from '../mesas/consultas';
import { textoModo } from '../mesas/textos';
import { armarTablero, useMeserosEnVivo } from './enVivo';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';

/**
 * "En vivo" de Meseros (MVP): cuánto lleva cada mesero HOY, cobrado + en curso, y su lugar.
 * Se actualiza solo: con el socket, en cuanto la sucursal manda cheques o mesas; sin él, cada
 * 20 s. Una sucursal desconectada no suma lo que tenía en curso (misma regla del Monitor).
 */
export function MeserosEnVivoTarjeta({
  filtro,
  dia,
  zona,
}: {
  filtro: Filtro | null;
  dia: string;
  zona: string;
}) {
  const { consulta, enVivo } = useMeserosEnVivo(filtro, dia);
  return (
    <Tarjeta titulo="En vivo · hoy">
      <p
        className="mb-2 text-xs text-tinta-tenue"
        data-testid="en-vivo-modo"
        data-modo={enVivo ? 'en-vivo' : 'polling'}
      >
        {consulta.dataUpdatedAt > 0
          ? `Actualizado ${horaEn(zona, consulta.dataUpdatedAt)} · ${textoModo(enVivo)}`
          : 'Sin consultar todavía'}
      </p>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(r) => <Tablero r={r} respuestaAt={consulta.dataUpdatedAt} />}
      </SegunEstado>
    </Tarjeta>
  );
}

function Tablero({
  r,
  respuestaAt,
}: {
  r: Parameters<typeof armarTablero>[0];
  respuestaAt: number;
}) {
  const ahora = useAhora();
  const t = armarTablero(r, respuestaAt, ahora);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="en-vivo-totales">
        <div>
          <dt className="text-xs text-tinta-suave">Cobrado hoy</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="en-vivo-cobrado">
            {formatearPesos(t.cobrado)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">En curso (mesas abiertas)</dt>
          <dd className="text-lg font-semibold tabular-nums" data-testid="en-vivo-en-curso">
            {formatearPesos(t.enCurso)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Mesas abiertas</dt>
          <dd className="text-lg font-semibold tabular-nums">{t.mesasAbiertas}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Cuentas cobradas</dt>
          <dd className="text-lg font-semibold tabular-nums">{t.cuentas}</dd>
        </div>
      </dl>
      {t.desconectadas.length > 0 && (
        <p className="mt-2 text-sm text-aviso" role="status" data-testid="en-vivo-desconectadas">
          Sin conexión en vivo: {t.desconectadas.join(', ')}. Su cobrado sí cuenta; lo que tenía en
          curso no se suma hasta que su agente vuelva a reportar.
        </p>
      )}
      {t.sinReporte.length > 0 && (
        <p className="mt-2 text-xs text-tinta-tenue">
          Sin reporte de mesas todavía: {t.sinReporte.join(', ')}.
        </p>
      )}
      {t.filas.length === 0 ? (
        <Vacio>Todavía no hay cuentas cobradas ni mesas abiertas hoy.</Vacio>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max text-sm" data-testid="tabla-en-vivo">
            <thead className="text-left text-xs text-tinta-suave">
              <tr>
                <th className={TH}>Lugar</th>
                <th className={TH}>Mesero</th>
                <th className={TH}>Sucursal</th>
                <th className={`${TH} text-right`}>Cobrado</th>
                <th className={`${TH} text-right`}>Cuentas</th>
                <th className={`${TH} text-right`}>Ticket prom.</th>
                <th className={`${TH} text-right`}>Comensales</th>
                <th className={`${TH} text-right`}>En curso</th>
                <th className={`${TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {t.filas.map((f) => (
                <tr key={`${f.sucursalId}|${f.mesero ?? ''}`} data-testid="fila-en-vivo">
                  <td className={NUM}>{f.posicion ?? '—'}</td>
                  <td className={`${TD} ${f.mesero === null ? 'italic text-tinta-tenue' : ''}`}>
                    {f.mesero ?? 'Sin mesero'}
                  </td>
                  <td className={TD}>{f.sucursal}</td>
                  <td className={NUM}>{pesos(f.cobrado)}</td>
                  <td className={NUM}>{f.cuentas}</td>
                  <td className={NUM}>
                    {f.ticketPromedio === null ? '—' : pesos(f.ticketPromedio)}
                  </td>
                  <td className={NUM}>{f.comensales + f.comensalesEnMesa}</td>
                  <td className={NUM} data-testid="en-vivo-fila-en-curso">
                    {f.enCurso === null
                      ? 'Sin conexión'
                      : `${formatearPesos(f.enCurso)} · ${f.mesasAbiertas} mesa${f.mesasAbiertas === 1 ? '' : 's'}${
                          f.mesasSinTotal > 0 ? ` (${f.mesasSinTotal} sin total)` : ''
                        }`}
                  </td>
                  <td className={`${NUM} font-medium`} data-testid="en-vivo-fila-total">
                    {formatearPesos(f.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-tinta-tenue">
            Lugar: por total (cobrado + en curso), dentro de su sucursal. Comensales: los de sus
            cuentas cobradas más los de sus mesas abiertas. El mesero se liga por el nombre del POS.
          </p>
        </div>
      )}
    </>
  );
}
