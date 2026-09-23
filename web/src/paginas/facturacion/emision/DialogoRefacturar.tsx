import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ErrorApi } from '../../../api/cliente';
import type { CfdiFila, ResultadoRefacturacion } from '../../../api/tipos';
import { pesos } from '../../../dinero/dinero';
import { Dialogo } from '../../admin/Dialogo';
import { useCatalogosSat } from '../../portal/consultas';
import { LLAVE_TABLERO } from '../tablero/consultas';
import { CamposReceptor } from './CamposReceptor';
import { refacturarCfdi } from './consultas';
import {
  camposFacturaDelApi,
  erroresReceptorAdmin,
  formDeReceptor,
  receptorParaApi,
  type ErroresFactura,
  type FormReceptor,
} from './reglas';

const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte px-3 py-1 text-sm hover:bg-realce disabled:opacity-50';

/**
 * Refacturación guiada (F2-107), en una sola acción: se emite un SUSTITUTO con los datos del
 * receptor corregidos (relación 04 con esta factura, mismos importes) y DESPUÉS se cancela esta
 * con motivo 01. Si el sustituto ya existe y sólo falta la cancelación (`sustitucionPendiente`), el
 * diálogo sólo la reintenta: no pide datos ni emite otro.
 */
export function DialogoRefacturar({ cfdi, onCerrar }: { cfdi: CfdiFila; onCerrar: () => void }) {
  const catalogos = useCatalogosSat(true);
  const cliente = useQueryClient();
  const soloCancelar = cfdi.sustitucionPendiente;
  const [receptor, setReceptor] = useState<FormReceptor>(() => formDeReceptor(cfdi.receptor));
  const [errores, setErrores] = useState<ErroresFactura>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoRefacturacion | null>(null);
  const regimenes = catalogos.data?.regimenesFiscales ?? [];
  const usos = catalogos.data?.usosCfdi ?? [];

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setAviso(null);
    if (!soloCancelar) {
      const locales = erroresReceptorAdmin(receptor, regimenes, usos);
      setErrores(locales);
      if (Object.keys(locales).length > 0) return;
    }
    setEnviando(true);
    try {
      const r = await refacturarCfdi(cfdi.id, receptorParaApi(receptor));
      setResultado(r);
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

  if (resultado) {
    return (
      <Dialogo titulo="Refacturación" onCerrar={onCerrar}>
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p>
            Sustituto emitido: <strong>{resultado.nuevo.serieFolio}</strong> por{' '}
            {pesos(resultado.nuevo.total)}, con relación 04 a la factura {cfdi.serieFolio}.
          </p>
          <p className="font-mono text-xs">{resultado.nuevo.uuid}</p>
          {resultado.cancelacion === 'cancelado' ? (
            <p>La factura {cfdi.serieFolio} quedó cancelada (motivo 01).</p>
          ) : (
            <p className="text-peligro">{resultado.mensaje}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={PRIMARIO} onClick={onCerrar}>
            Listo
          </button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo
      titulo={soloCancelar ? 'Reintentar la cancelación' : `Refacturar ${cfdi.serieFolio}`}
      onCerrar={onCerrar}
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => void confirmar(e)} noValidate>
        {soloCancelar ? (
          <p className="text-sm">
            El sustituto de {cfdi.serieFolio} ya se emitió
            {cfdi.sustituidoPor ? ` (${cfdi.sustituidoPor})` : ''}, pero la cancelación de esta
            factura no se confirmó. Se reintenta SÓLO la cancelación con motivo 01; no se emite otra
            factura.
          </p>
        ) : (
          <>
            <ol className="list-decimal pl-5 text-sm text-tinta-suave">
              <li>
                Se emite una factura nueva por {pesos(cfdi.total)} con los datos corregidos, que
                sustituye a {cfdi.serieFolio} (relación 04).
              </li>
              <li>Después se cancela {cfdi.serieFolio} con motivo 01 (emitida con errores).</li>
            </ol>
            <p className="text-xs text-tinta-tenue">
              Sólo se corrigen los datos del receptor; el importe es el mismo.
            </p>
            {catalogos.isError ? (
              <p role="alert" className="text-sm text-peligro">
                No se pudieron cargar los catálogos del SAT. Cierra y vuelve a intentar.
              </p>
            ) : (
              <CamposReceptor
                valor={receptor}
                onCambio={setReceptor}
                errores={errores}
                regimenes={regimenes}
                usos={usos}
                deshabilitado={enviando}
              />
            )}
          </>
        )}
        {aviso && (
          <p role="alert" className="text-sm text-peligro">
            {aviso}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BOTON} onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
          <button
            type="submit"
            className={PRIMARIO}
            disabled={enviando || (!soloCancelar && catalogos.isPending)}
          >
            {enviando
              ? 'Procesando…'
              : soloCancelar
                ? 'Reintentar cancelación'
                : 'Emitir sustituto y cancelar'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
