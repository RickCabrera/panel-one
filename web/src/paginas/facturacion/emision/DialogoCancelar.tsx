import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ErrorApi } from '../../../api/cliente';
import type { CfdiFila, MotivoCancelacion, ResultadoCancelacion } from '../../../api/tipos';
import { pesos } from '../../../dinero/dinero';
import { Dialogo } from '../../admin/Dialogo';
import { LLAVE_TABLERO } from '../tablero/consultas';
import { TEXTO_MOTIVO, motivosPara, pedidoCancelacion } from './cancelacion';
import { cancelarCfdi } from './consultas';

const PRIMARIO =
  'rounded-md bg-peligro-fuerte px-3 py-1 text-sm font-medium text-sobre-peligro disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte px-3 py-1 text-sm hover:bg-realce disabled:opacity-50';

/**
 * Cancelar una factura ante el SAT (F2-109): elegir el motivo (sólo los que aplican a la factura),
 * confirmar y ver en qué quedó (cancelada, o EN PROCESO si el receptor tiene que aceptarla). Con
 * motivo 01 hace falta el sustituto: si la factura ya lo tiene (refacturación con la cancelación
 * pendiente) se manda su UUID; si no, el formulario NO deja continuar y ofrece "Refacturar".
 */
export function DialogoCancelar({
  cfdi,
  onCerrar,
  onRefacturar,
}: {
  cfdi: CfdiFila;
  onCerrar: () => void;
  onRefacturar: () => void;
}) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState<MotivoCancelacion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCancelacion | null>(null);
  const pedido = pedidoCancelacion(cfdi, motivo);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (enviando || !pedido.ok) return;
    setAviso(null);
    setEnviando(true);
    try {
      setResultado(await cancelarCfdi(cfdi.id, pedido.pedido));
      void cliente.invalidateQueries({ queryKey: LLAVE_TABLERO });
    } catch (error) {
      setAviso(error instanceof ErrorApi ? error.message : 'Error inesperado.');
      // Un 502 (el PAC no confirmó) deja una solicitud abierta: la tabla la tiene que mostrar.
      void cliente.invalidateQueries({ queryKey: LLAVE_TABLERO });
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <Dialogo titulo="Cancelación" onCerrar={onCerrar}>
        <div role="status" className="flex flex-col gap-2 text-sm">
          {resultado.estado === 'cancelado' ? (
            <p>
              La factura <strong>{cfdi.serieFolio}</strong> quedó CANCELADA ante el SAT (motivo{' '}
              {resultado.motivo}).
              {cfdi.receptor.email ? ` Se avisó a ${cfdi.receptor.email}.` : ''}
            </p>
          ) : (
            <p>{resultado.mensaje}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={BOTON} onClick={onCerrar}>
            Listo
          </button>
        </div>
      </Dialogo>
    );
  }

  const motivos = motivosPara(cfdi);
  return (
    <Dialogo titulo={`Cancelar ${cfdi.serieFolio}`} onCerrar={onCerrar}>
      <form className="flex flex-col gap-3" onSubmit={(e) => void confirmar(e)} noValidate>
        <p className="text-sm">
          Factura {cfdi.serieFolio} por {pesos(cfdi.total)} a {cfdi.receptorNombre} (
          {cfdi.receptorRfc}).
        </p>
        <fieldset className="flex flex-col gap-1" disabled={enviando}>
          <legend className="mb-1 text-sm font-medium">Motivo de cancelación (SAT)</legend>
          {motivos.map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="motivo"
                value={m}
                checked={motivo === m}
                onChange={() => setMotivo(m)}
              />
              <span>
                <strong>{m}</strong> · {TEXTO_MOTIVO[m]}
              </span>
            </label>
          ))}
        </fieldset>
        {motivo === '01' && pedido.ok && (
          <p className="text-sm">
            Sustituto: <span className="font-mono text-xs">{cfdi.sustituidoPor}</span>
          </p>
        )}
        {!pedido.ok && pedido.razon && (
          <div role="alert" className="flex flex-col gap-2 text-sm text-peligro">
            <p>{pedido.razon}</p>
            {motivo === '01' && cfdi.origen !== 'global' && !cfdi.sustitucionPendiente && (
              <button type="button" className={`${BOTON} self-start`} onClick={onRefacturar}>
                Refacturar en su lugar
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-tinta-tenue">
          La cancelación ante el SAT no se deshace. Si el receptor tiene que aceptarla, queda EN
          PROCESO (hasta 72 horas) y la factura sigue vigente mientras tanto.
        </p>
        {aviso && (
          <p role="alert" className="text-sm text-peligro">
            {aviso}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON} onClick={onCerrar} disabled={enviando}>
            Volver
          </button>
          <button type="submit" className={PRIMARIO} disabled={enviando || !pedido.ok}>
            {enviando ? 'Cancelando…' : 'Cancelar ante el SAT'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
