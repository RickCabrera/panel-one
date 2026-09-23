import { useId } from 'react';

import type { RegimenFiscal, UsoCfdi } from '../../../api/tipos';
import { regimenesPara, usosPara } from '../../portal/reglas';
import type { ErroresFactura, FormReceptor } from './reglas';

export const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
export const ETIQUETA = 'flex min-w-0 flex-col gap-1 text-sm';
export const ERROR_CAMPO = 'text-xs text-peligro';

/**
 * Los datos del receptor de un CFDI (F2-107), con los catálogos del SAT que llegan del api. Los
 * regímenes se filtran por el tipo de persona del RFC y los usos por el régimen, como en el portal.
 * El correo es opcional: sin él la factura no se envía (se descarga del tablero).
 */
export function CamposReceptor({
  valor,
  onCambio,
  errores,
  regimenes,
  usos,
  deshabilitado = false,
}: {
  valor: FormReceptor;
  onCambio: (r: FormReceptor) => void;
  errores: ErroresFactura;
  regimenes: readonly RegimenFiscal[];
  usos: readonly UsoCfdi[];
  deshabilitado?: boolean;
}) {
  const id = useId();
  const poner = (campo: keyof FormReceptor, v: string) => onCambio({ ...valor, [campo]: v });
  const error = (campo: keyof FormReceptor) =>
    errores[campo] ? (
      <span id={`${id}-${campo}-error`} className={ERROR_CAMPO}>
        {errores[campo]}
      </span>
    ) : null;
  const describe = (campo: keyof FormReceptor) =>
    errores[campo] ? `${id}-${campo}-error` : undefined;
  const regimenesVisibles = regimenesPara(valor.rfc, regimenes);
  const usosVisibles = usosPara(valor.rfc, valor.regimenFiscal, usos);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          RFC del receptor
          <input
            className={CONTROL}
            value={valor.rfc}
            maxLength={13}
            autoComplete="off"
            disabled={deshabilitado}
            aria-invalid={errores.rfc ? true : undefined}
            aria-describedby={describe('rfc')}
            onChange={(e) => poner('rfc', e.target.value)}
          />
        </label>
        {error('rfc')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          Nombre o razón social
          <input
            className={CONTROL}
            value={valor.razonSocial}
            maxLength={254}
            disabled={deshabilitado}
            aria-invalid={errores.razonSocial ? true : undefined}
            aria-describedby={describe('razonSocial')}
            onChange={(e) => poner('razonSocial', e.target.value)}
          />
        </label>
        {error('razonSocial')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          Régimen fiscal
          <select
            className={CONTROL}
            value={valor.regimenFiscal}
            disabled={deshabilitado}
            aria-invalid={errores.regimenFiscal ? true : undefined}
            aria-describedby={describe('regimenFiscal')}
            onChange={(e) => onCambio({ ...valor, regimenFiscal: e.target.value, usoCfdi: '' })}
          >
            <option value="">Elige…</option>
            {regimenesVisibles.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.clave} · {r.descripcion}
              </option>
            ))}
          </select>
        </label>
        {error('regimenFiscal')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          Código postal fiscal
          <input
            className={CONTROL}
            value={valor.cp}
            inputMode="numeric"
            maxLength={5}
            disabled={deshabilitado}
            aria-invalid={errores.cp ? true : undefined}
            aria-describedby={describe('cp')}
            onChange={(e) => poner('cp', e.target.value)}
          />
        </label>
        {error('cp')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          Uso del CFDI
          <select
            className={CONTROL}
            value={valor.usoCfdi}
            disabled={deshabilitado || !valor.regimenFiscal}
            aria-invalid={errores.usoCfdi ? true : undefined}
            aria-describedby={describe('usoCfdi')}
            onChange={(e) => poner('usoCfdi', e.target.value)}
          >
            <option value="">{valor.regimenFiscal ? 'Elige…' : 'Primero el régimen'}</option>
            {usosVisibles.map((u) => (
              <option key={u.clave} value={u.clave}>
                {u.clave} · {u.descripcion}
              </option>
            ))}
          </select>
        </label>
        {error('usoCfdi')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label className={ETIQUETA}>
          Correo (opcional)
          <input
            className={CONTROL}
            type="email"
            value={valor.email}
            maxLength={254}
            disabled={deshabilitado}
            aria-invalid={errores.email ? true : undefined}
            aria-describedby={describe('email')}
            onChange={(e) => poner('email', e.target.value)}
          />
        </label>
        {error('email')}
      </div>
    </div>
  );
}
