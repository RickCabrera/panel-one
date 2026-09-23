import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import { ErrorApi } from '../../../api/cliente';
import type { EstadoFolios, ReporteFolios } from '../../../api/tipos';
import { descargar } from '../../../csv/csv';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from '../../inicio/Tarjeta';
import {
  borrarPaquete,
  guardarUmbral,
  LLAVE_FOLIOS,
  registrarPaquete,
  useEstadoFolios,
  useReporteFolios,
} from './consultas';
import {
  csvReporte,
  erroresPaquete,
  explicacionSaldo,
  fechaFolios,
  hoyFolios,
  moverMes,
  nombreMes,
  porcentajeDisponible,
  rangoPorOmision,
  TEXTO_PAQUETE,
  TEXTO_SALDO,
  ultimoDiaUtil,
} from './reglas';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte px-2 py-0.5 text-xs hover:bg-realce disabled:opacity-50';
const NUM = 'px-2 py-1 text-right tabular-nums';
const TH = 'px-2 py-1 text-left font-medium';
const THN = 'px-2 py-1 text-right font-medium';
const ETIQUETA = 'flex flex-col gap-1 text-sm';

const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Error inesperado.');
const miles = (n: number) => n.toLocaleString('es-MX');

/**
 * Folios del PAC (F2-110), sólo para admin_global: el saldo de la PLATAFORMA (la cuenta del
 * proveedor de timbrado), los paquetes comprados, el umbral de aviso, el consumo por empresa y el
 * reporte mensual para el recobro. Un paquete vence 12 meses después de su compra; los folios se
 * gastan del que vence primero.
 */
export function Folios() {
  const consulta = useEstadoFolios();
  return (
    <>
      <p className="mb-4 text-sm text-tinta-tenue">
        El saldo de folios de timbrado de toda la plataforma. Cada factura emitida (vigente o
        cancelada, incluidas la global y las refacturaciones) gasta un folio; cancelar no gasta.
      </p>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(e) => (
          <div className="flex flex-col gap-4">
            <Saldo e={e} />
            <Paquetes e={e} />
            <ConsumoPorEmpresa e={e} />
            <Reporte />
          </div>
        )}
      </SegunEstado>
    </>
  );
}

function Saldo({ e }: { e: EstadoFolios }) {
  const pct = porcentajeDisponible(e);
  const alarma = e.estado === 'agotado' ? 'peligro' : e.estado === 'bajo' ? 'aviso' : null;
  return (
    <Tarjeta titulo="Saldo de folios">
      {alarma && (
        <p
          role="alert"
          data-testid="aviso-saldo"
          className={
            alarma === 'peligro'
              ? 'mb-3 rounded-md border border-peligro-borde bg-peligro-fondo px-3 py-2 text-sm text-peligro-fuerte'
              : 'mb-3 rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-sm text-aviso-fuerte'
          }
        >
          {explicacionSaldo(e)}
        </p>
      )}
      {e.estado === 'sin_control' ? (
        <p className="text-sm text-tinta-tenue" data-testid="sin-control">
          {explicacionSaldo(e)}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums" data-testid="disponible">
              {miles(e.disponible)}
            </span>
            <span className="text-sm text-tinta-suave">
              de {miles(e.vigenteTotal)} folios vigentes
              {pct !== null && ` · ${pct} %`}
            </span>
            <span className="text-sm font-medium">{TEXTO_SALDO[e.estado]}</span>
          </div>
          {pct !== null && (
            <div
              className="h-2 w-full overflow-hidden rounded bg-realce-fuerte"
              role="meter"
              aria-label="Folios disponibles"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="h-full bg-acento" style={{ width: `${pct}%` }} />
            </div>
          )}
          {e.estado === 'ok' && <p className="text-xs text-tinta-tenue">{explicacionSaldo(e)}</p>}
          {e.enEmision > 0 && (
            <p className="text-xs text-tinta-tenue" data-testid="en-emision">
              {e.enEmision === 1 ? '1 factura' : `${e.enEmision} facturas`} en emisión ya descontada
              {e.enEmision === 1 ? '' : 's'}. Si alguna se quedó sin confirmar del proveedor, su
              folio sigue apartado hasta que se concilie.
            </p>
          )}
          {e.sobregiro > 0 && (
            <p className="text-xs text-tinta-tenue" data-testid="sobregiro">
              {miles(e.sobregiro)}{' '}
              {e.sobregiro === 1 ? 'factura se emitió' : 'facturas se emitieron'} sin paquete
              vigente que las cubriera.
            </p>
          )}
        </div>
      )}
      <Umbral umbralPct={e.umbralPct} />
    </Tarjeta>
  );
}

function Umbral({ umbralPct }: { umbralPct: number }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [valor, setValor] = useState(String(umbralPct));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const n = Number(valor);
    if (!/^\d+$/.test(valor.trim()) || n < 1 || n > 100) {
      setError('El aviso va de 1 % a 100 %.');
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarUmbral(n);
      queryClient.setQueryData([...LLAVE_FOLIOS, 'estado'], r);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form
      onSubmit={guardar}
      noValidate
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-linea-suave pt-3"
    >
      <label htmlFor={id} className={ETIQUETA}>
        <span>Avisar por correo cuando quede menos de (%)</span>
        <input
          id={id}
          className={`${CONTROL} w-24`}
          inputMode="numeric"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </label>
      <button type="submit" className={PRIMARIO} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar aviso'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-peligro">
          {error}
        </p>
      )}
    </form>
  );
}

function Paquetes({ e }: { e: EstadoFolios }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  async function borrar(id: string) {
    setError(null);
    setBorrando(id);
    try {
      await borrarPaquete(id);
      await queryClient.invalidateQueries({ queryKey: LLAVE_FOLIOS });
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setBorrando(null);
    }
  }

  return (
    <Tarjeta titulo="Paquetes comprados">
      {e.paquetes.length === 0 ? (
        <Vacio>Todavía no se ha registrado ningún paquete.</Vacio>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-tinta-tenue">
              <tr>
                <th className={TH}>Comprado</th>
                <th className={TH}>Sirve hasta</th>
                <th className={THN}>Folios</th>
                <th className={THN}>Usados</th>
                <th className={THN}>Quedan</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Nota</th>
                <th className={TH}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {e.paquetes.map((p) => (
                <tr key={p.id} className="border-t border-linea-suave">
                  <td className="px-2 py-1">{fechaFolios(p.compradoAt)}</td>
                  <td className="px-2 py-1">{ultimoDiaUtil(p.venceAt)}</td>
                  <td className={NUM}>{miles(p.cantidad)}</td>
                  <td className={NUM}>{miles(p.consumidos)}</td>
                  <td className={NUM}>{p.estado === 'vencido' ? '—' : miles(p.restantes)}</td>
                  <td className="px-2 py-1">
                    {TEXTO_PAQUETE[p.estado]}
                    {p.estado === 'por_vencer' && p.diasParaVencer !== null && (
                      <span className="text-tinta-tenue">
                        {' '}
                        · {p.diasParaVencer === 1 ? '1 día' : `${p.diasParaVencer} días`}
                      </span>
                    )}
                    {p.estado === 'vencido' && p.restantes > 0 && (
                      <span className="text-tinta-tenue"> · se perdieron {miles(p.restantes)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-tinta-suave">{p.nota ?? ''}</td>
                  <td className="px-2 py-1">
                    {p.consumidos === 0 && (
                      <button
                        type="button"
                        className={BOTON}
                        disabled={borrando !== null}
                        onClick={() => void borrar(p.id)}
                      >
                        {borrando === p.id ? 'Borrando…' : 'Borrar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {error}
        </p>
      )}
      <AltaPaquete />
    </Tarjeta>
  );
}

function AltaPaquete() {
  const queryClient = useQueryClient();
  const base = useId();
  const hoy = hoyFolios(new Date());
  const [form, setForm] = useState({ cantidad: '', fechaCompra: hoy, nota: '' });
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errores = erroresPaquete(form, hoy);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setIntentado(true);
    setError(null);
    if (Object.keys(errores).length > 0) return;
    setEnviando(true);
    try {
      await registrarPaquete({
        cantidad: Number(form.cantidad),
        fechaCompra: form.fechaCompra,
        ...(form.nota.trim() ? { nota: form.nota.trim() } : {}),
      });
      setForm({ cantidad: '', fechaCompra: hoy, nota: '' });
      setIntentado(false);
      await queryClient.invalidateQueries({ queryKey: LLAVE_FOLIOS });
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      className="mt-4 grid gap-3 border-t border-linea-suave pt-4 sm:grid-cols-3"
    >
      <h3 className="text-sm font-medium sm:col-span-3">Registrar un paquete comprado</h3>
      <div className={ETIQUETA}>
        <label htmlFor={`${base}-cantidad`}>Folios</label>
        <input
          id={`${base}-cantidad`}
          className={CONTROL}
          inputMode="numeric"
          value={form.cantidad}
          onChange={(e) => setForm((f) => ({ ...f, cantidad: e.target.value }))}
          aria-invalid={intentado && errores.cantidad ? true : undefined}
        />
        {intentado && errores.cantidad && (
          <span className="text-xs text-peligro">{errores.cantidad}</span>
        )}
      </div>
      <div className={ETIQUETA}>
        <label htmlFor={`${base}-fecha`}>Día de compra</label>
        <input
          id={`${base}-fecha`}
          type="date"
          className={CONTROL}
          max={hoy}
          value={form.fechaCompra}
          onChange={(e) => setForm((f) => ({ ...f, fechaCompra: e.target.value }))}
          aria-invalid={intentado && errores.fechaCompra ? true : undefined}
        />
        <span
          className={
            intentado && errores.fechaCompra ? 'text-xs text-peligro' : 'text-xs text-tinta-tenue'
          }
        >
          {intentado && errores.fechaCompra
            ? errores.fechaCompra
            : 'Hora de la Ciudad de México. Vence 12 meses después.'}
        </span>
      </div>
      <div className={ETIQUETA}>
        <label htmlFor={`${base}-nota`}>Nota (opcional)</label>
        <input
          id={`${base}-nota`}
          className={CONTROL}
          maxLength={200}
          value={form.nota}
          onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-3">
          {error}
        </p>
      )}
      <div className="sm:col-span-3">
        <button type="submit" className={PRIMARIO} disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar paquete'}
        </button>
      </div>
    </form>
  );
}

function ConsumoPorEmpresa({ e }: { e: EstadoFolios }) {
  return (
    <Tarjeta titulo="Consumo por empresa">
      {e.consumoPorEmpresa.length === 0 ? (
        <Vacio>Ninguna empresa ha emitido facturas en los últimos 12 meses.</Vacio>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-tinta-tenue">
              <tr>
                <th className={TH}>Empresa</th>
                <th className={THN}>Este mes</th>
                <th className={THN}>Últimos 12 meses</th>
              </tr>
            </thead>
            <tbody>
              {e.consumoPorEmpresa.map((c) => (
                <tr key={c.empresaId} className="border-t border-linea-suave">
                  <td className="px-2 py-1">{c.empresa}</td>
                  <td className={NUM}>{miles(c.mesActual)}</td>
                  <td className={NUM}>{miles(c.ultimos12Meses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-tinta-tenue">
            El mes de cada factura es el de la zona horaria de la sucursal que la emitió.
          </p>
        </div>
      )}
    </Tarjeta>
  );
}

function Reporte() {
  const inicial = rangoPorOmision(new Date());
  const [rango, setRango] = useState(inicial);
  const consulta = useReporteFolios(rango.desde, rango.hasta);
  const base = useId();
  const mover = (delta: number) =>
    setRango((r) => ({ desde: moverMes(r.desde, delta), hasta: moverMes(r.hasta, delta) }));

  return (
    <Tarjeta titulo="Reporte mensual de timbres">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <button type="button" className={BOTON} onClick={() => mover(-12)}>
          12 meses antes
        </button>
        <span className="text-sm" id={`${base}-rango`}>
          De {nombreMes(rango.desde)} a {nombreMes(rango.hasta)}
        </span>
        <button
          type="button"
          className={BOTON}
          disabled={rango.hasta >= inicial.hasta}
          onClick={() => mover(12)}
        >
          12 meses después
        </button>
        {consulta.data && (
          <button
            type="button"
            className={BOTON}
            onClick={() =>
              descargar(
                `folios_${rango.desde}_${rango.hasta}.csv`,
                csvReporte(consulta.data as ReporteFolios),
              )
            }
          >
            Descargar CSV
          </button>
        )}
      </div>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(r) => <TablaReporte r={r} />}
      </SegunEstado>
    </Tarjeta>
  );
}

function TablaReporte({ r }: { r: ReporteFolios }) {
  const conTimbres = r.totales.filter((t) => t.total > 0);
  if (conTimbres.length === 0) {
    return <Vacio>No se emitió ninguna factura en estos meses: no hubo folios consumidos.</Vacio>;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-tinta-tenue">
          <tr>
            <th className={TH}>Mes</th>
            <th className={TH}>Empresa</th>
            <th className={THN}>Vigentes</th>
            <th className={THN}>Cancelados</th>
            <th className={THN}>Folios</th>
          </tr>
        </thead>
        <tbody>
          {r.totales.map((t) => {
            const filas = r.filas.filter((f) => f.mes === t.mes);
            return [
              ...filas.map((f) => (
                <tr key={`${f.mes}-${f.empresaId}`} className="border-t border-linea-suave">
                  <td className="px-2 py-1">{nombreMes(f.mes)}</td>
                  <td className="px-2 py-1">{f.empresa}</td>
                  <td className={NUM}>{miles(f.vigentes)}</td>
                  <td className={NUM}>{miles(f.cancelados)}</td>
                  <td className={NUM}>{miles(f.total)}</td>
                </tr>
              )),
              <tr
                key={`${t.mes}-total`}
                className="border-t border-linea-suave font-medium"
                data-testid={`total-${t.mes}`}
              >
                <td className="px-2 py-1">{nombreMes(t.mes)}</td>
                <td className="px-2 py-1">{t.total === 0 ? 'Sin facturas' : 'Total del mes'}</td>
                <td className={NUM}>{miles(t.vigentes)}</td>
                <td className={NUM}>{miles(t.cancelados)}</td>
                <td className={NUM}>{miles(t.total)}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
