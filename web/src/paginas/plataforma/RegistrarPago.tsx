import { useState, type FormEvent } from 'react';

import type { MetodoPago } from '../../api/tipos';
import { aCentavos, pesos } from '../../dinero/dinero';
import { Dialogo } from '../admin/Dialogo';
import { apiPlataforma, useAccionPlataforma } from './consultas';
import { C } from './estilos';
import { fechaDia, hoyEnPlataforma, TEXTO_METODO } from './formato';

const METODOS: MetodoPago[] = ['transferencia', 'efectivo', 'tarjeta', 'otro'];

/** `123450n` → `"1234.50"` (el texto que acepta la API). */
function textoDeCentavos(c: bigint): string {
  return `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
}

export interface ClienteAPagar {
  empresaId: string;
  empresa: string;
  plan: string;
  /** Precio mensual del plan, texto de la API. */
  precioMensual: string;
  vencimiento: string;
  periodicidad?: 'mensual' | 'anual';
}

/**
 * Registrar un pago a mano (transferencia, efectivo, tarjeta...). La API corre el vencimiento
 * desde el vencimiento ACTUAL tantos periodos como diga `periodos`, y reactiva si estaba
 * suspendida o en prueba. El monto viaja como texto: nunca pasa por `number`.
 */
export function RegistrarPago({
  cliente,
  onCerrar,
}: {
  cliente: ClienteAPagar;
  onCerrar: () => void;
}) {
  const accion = useAccionPlataforma();
  const anual = cliente.periodicidad === 'anual';
  // Anual: 12 × el precio mensual, en centavos exactos (nunca float).
  const centavos = aCentavos(cliente.precioMensual);
  const sugerido =
    anual && centavos !== null ? textoDeCentavos(centavos * 12n) : cliente.precioMensual;
  const [monto, setMonto] = useState(sugerido);
  const [fechaPago, setFechaPago] = useState(hoyEnPlataforma());
  const [metodo, setMetodo] = useState<MetodoPago>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [periodos, setPeriodos] = useState('1');
  const [notas, setNotas] = useState('');
  const [hecho, setHecho] = useState<string | null>(null);
  const montoValido = aCentavos(monto) !== null && (aCentavos(monto) ?? 0n) > 0n;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!montoValido) return;
    const r = await accion.correr(() =>
      apiPlataforma.registrarPago(cliente.empresaId, {
        monto: monto.trim(),
        fechaPago,
        metodo,
        referencia: referencia.trim() || null,
        notas: notas.trim() || null,
        periodos: Number(periodos),
      }),
    );
    if (r.ok) {
      setHecho(`Pago registrado. Ahora vence el ${fechaDia(r.valor.suscripcion.vencimiento)}.`);
    }
  }

  return (
    <Dialogo titulo={`Registrar pago de ${cliente.empresa}`} onCerrar={onCerrar}>
      {hecho ? (
        <div className="space-y-4">
          <p role="status" className={C.exito}>
            {hecho}
          </p>
          <div className="flex justify-end">
            <button type="button" className={C.primario} onClick={onCerrar}>
              Listo
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void enviar(e)} className="space-y-3">
          <p className="text-sm text-tinta-suave">
            Plan {cliente.plan} · {pesos(cliente.precioMensual)} al mes · vence el{' '}
            {fechaDia(cliente.vencimiento)}. El pago corre el vencimiento desde esa fecha.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={C.etiqueta}>
              Monto (MXN)
              <input
                className={C.input}
                inputMode="decimal"
                required
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                aria-invalid={!montoValido}
              />
            </label>
            <label className={C.etiqueta}>
              Fecha de pago
              <input
                className={C.input}
                type="date"
                required
                max={hoyEnPlataforma()}
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
              />
            </label>
            <label className={C.etiqueta}>
              Método
              <select
                className={C.input}
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as MetodoPago)}
              >
                {METODOS.map((m) => (
                  <option key={m} value={m}>
                    {TEXTO_METODO[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={C.etiqueta}>
              {anual ? 'Años que cubre' : 'Meses que cubre'}
              <input
                className={C.input}
                type="number"
                min={1}
                max={24}
                required
                value={periodos}
                onChange={(e) => setPeriodos(e.target.value)}
              />
            </label>
          </div>
          <label className={C.etiqueta}>
            Referencia (opcional)
            <input
              className={C.input}
              maxLength={120}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </label>
          <label className={C.etiqueta}>
            Notas (opcional)
            <textarea
              className={C.input}
              maxLength={1000}
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </label>
          {!montoValido && (
            <p className="text-sm text-peligro">
              El monto es un importe mayor que cero con hasta 2 decimales.
            </p>
          )}
          {accion.error && (
            <p role="alert" className={C.error}>
              {accion.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={C.secundario} onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className={C.primario} disabled={accion.enCurso || !montoValido}>
              Registrar pago
            </button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}
