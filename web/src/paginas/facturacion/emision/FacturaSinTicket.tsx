import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ErrorApi } from '../../../api/cliente';
import type { FacturaEmitidaAdmin, FormaPagoManual, Sucursal } from '../../../api/tipos';
import { pesos } from '../../../dinero/dinero';
import { useCatalogosSat } from '../../portal/consultas';
import { Tarjeta, Vacio } from '../../inicio/Tarjeta';
import { LLAVE_TABLERO } from '../tablero/consultas';
import { CamposReceptor, CONTROL, ERROR_CAMPO, ETIQUETA } from './CamposReceptor';
import { emitirFacturaManual } from './consultas';
import {
  camposFacturaDelApi,
  erroresReceptorAdmin,
  FORM_RECEPTOR_VACIO,
  MENSAJE_TOTAL,
  nuevaSolicitud,
  receptorParaApi,
  totalValido,
  type ErroresFactura,
  type FormReceptor,
} from './reglas';

const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';

const FORMAS: readonly { valor: FormaPagoManual; texto: string }[] = [
  { valor: 'efectivo', texto: 'Efectivo (01)' },
  { valor: 'tarjeta', texto: 'Tarjeta (04)' },
  { valor: 'transferencia', texto: 'Transferencia (03)' },
];

/**
 * Factura sin ticket (F2-107): el administrador captura el total y el receptor y se emite un CFDI
 * ligado a la sucursal, sin cheque (`origen = manual`). Mismo concepto e IVA que la factura de un
 * ticket. La `solicitudId` es la misma mientras el formulario no cambie de captura: un doble clic o
 * un reintento tras un error de red no emiten dos veces (el api contesta 409 con la que ya salió).
 */
export function FacturaSinTicket({
  empresaId,
  sucursales,
}: {
  empresaId: string | null;
  sucursales: readonly Sucursal[];
}) {
  const catalogos = useCatalogosSat(true);
  const cliente = useQueryClient();
  const activas = sucursales.filter((s) => s.activo);
  const [sucursalId, setSucursalId] = useState('');
  const [total, setTotal] = useState('');
  const [formaPago, setFormaPago] = useState<FormaPagoManual>('efectivo');
  const [receptor, setReceptor] = useState<FormReceptor>(FORM_RECEPTOR_VACIO);
  const [errores, setErrores] = useState<ErroresFactura>({});
  const [solicitudId, setSolicitudId] = useState(nuevaSolicitud);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<FacturaEmitidaAdmin | null>(null);

  if (!empresaId) return <Vacio>Elige una empresa arriba para facturar.</Vacio>;
  if (catalogos.isError) {
    return <Vacio>No se pudieron cargar los catálogos del SAT. Recarga la página.</Vacio>;
  }
  const regimenes = catalogos.data?.regimenesFiscales ?? [];
  const usos = catalogos.data?.usosCfdi ?? [];
  const sucursalElegida = sucursalId || (activas.length === 1 ? activas[0].id : '');

  function nuevaCaptura() {
    setTotal('');
    setReceptor(FORM_RECEPTOR_VACIO);
    setErrores({});
    setAviso(null);
    setEmitida(null);
    setSolicitudId(nuevaSolicitud());
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!empresaId || enviando) return;
    const locales: ErroresFactura = erroresReceptorAdmin(receptor, regimenes, usos);
    if (!totalValido(total)) locales.total = MENSAJE_TOTAL;
    setErrores(locales);
    setAviso(null);
    if (!sucursalElegida) {
      setAviso('Elige la sucursal que expide la factura.');
      return;
    }
    if (Object.keys(locales).length > 0) return;
    setEnviando(true);
    try {
      const r = await emitirFacturaManual({
        empresaId,
        sucursalId: sucursalElegida,
        solicitudId,
        total: total.trim(),
        formaPago,
        receptor: receptorParaApi(receptor),
      });
      setEmitida(r);
      void cliente.invalidateQueries({ queryKey: LLAVE_TABLERO });
    } catch (error) {
      if (error instanceof ErrorApi && error.status === 400) {
        const campos = camposFacturaDelApi(error.cuerpo);
        if (campos) setErrores(campos);
        else setAviso(error.message);
      } else {
        setAviso(error instanceof ErrorApi ? error.message : 'Error inesperado.');
      }
    } finally {
      setEnviando(false);
    }
  }

  if (emitida) {
    return (
      <Tarjeta titulo="Factura emitida">
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p>
            Se emitió la factura <strong>{emitida.serieFolio}</strong> por{' '}
            <strong>{pesos(emitida.total)}</strong> (sin ticket).
          </p>
          <p className="font-mono text-xs">{emitida.uuid}</p>
          <p className="text-tinta-tenue">
            {emitida.email
              ? `Se envió a ${emitida.email}.`
              : 'Sin correo: descárgala desde la tabla de facturas del Tablero.'}
          </p>
        </div>
        <button type="button" className={`${PRIMARIO} mt-3`} onClick={nuevaCaptura}>
          Capturar otra
        </button>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Factura sin ticket">
      <p className="mb-3 text-sm text-tinta-tenue">
        Para una venta cuyo ticket no se puede facturar en el portal. Se emite con el mismo concepto
        (consumo de alimentos y bebidas) y el IVA se calcula del total. En el Tablero aparece
        marcada como “Manual”.
      </p>
      <form className="flex flex-col gap-3" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={ETIQUETA}>
            Sucursal que expide
            <select
              className={CONTROL}
              value={sucursalElegida}
              disabled={enviando}
              onChange={(e) => setSucursalId(e.target.value)}
            >
              <option value="">Elige…</option>
              {activas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-0 flex-col gap-1">
            <label className={ETIQUETA}>
              Total con IVA
              <input
                className={CONTROL}
                value={total}
                inputMode="decimal"
                placeholder="1234.50"
                maxLength={9}
                disabled={enviando}
                aria-invalid={errores.total ? true : undefined}
                aria-describedby={errores.total ? 'factura-manual-total-error' : undefined}
                onChange={(e) => setTotal(e.target.value)}
              />
            </label>
            {errores.total && (
              <span id="factura-manual-total-error" className={ERROR_CAMPO}>
                {errores.total}
              </span>
            )}
          </div>
          <label className={ETIQUETA}>
            Forma de pago
            <select
              className={CONTROL}
              value={formaPago}
              disabled={enviando}
              onChange={(e) => setFormaPago(e.target.value as FormaPagoManual)}
            >
              {FORMAS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.texto}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CamposReceptor
          valor={receptor}
          onCambio={setReceptor}
          errores={errores}
          regimenes={regimenes}
          usos={usos}
          deshabilitado={enviando}
        />
        {aviso && (
          <p role="alert" className="text-sm text-peligro">
            {aviso}
          </p>
        )}
        <div>
          <button type="submit" className={PRIMARIO} disabled={enviando || catalogos.isPending}>
            {enviando ? 'Emitiendo…' : 'Emitir factura'}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}
