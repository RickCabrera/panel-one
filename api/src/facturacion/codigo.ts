import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EstadoCodigoFacturacion, Prisma } from '@prisma/client';

import { fechaLocal, instanteDesdeLocal } from '../comun/fechas';

/**
 * El código corto de facturación de un cheque (F2-101): lo que el cliente teclea (o escanea) en
 * el portal de autofactura para encontrar su consumo. Todo lo de aquí es puro salvo
 * `GeneradorCodigo`, que es el punto de azar inyectable (los e2e fuerzan colisiones con él).
 *
 * Formato: 9 caracteres de A–Z y 2–9 SIN los ambiguos O, 0, I, 1 (32 símbolos, 32^9 ≈ 3.5·10^13
 * códigos). El del ticket de ejemplo de la ficha, `7JQRECP3U`, cumple. La base repite el formato
 * en un CHECK (`codigos_facturacion_codigo_formato_check`) y la unicidad es un constraint único.
 */

export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_CODIGO = 9;
export const REGEX_CODIGO = /^[A-HJ-NP-Z2-9]{9}$/;
/** El código del ticket de ejemplo de la ficha F2-101. El seed lo asigna a un cheque vigente. */
export const CODIGO_EJEMPLO = '7JQRECP3U';

/**
 * Un código al azar. `aleatorio(n)` devuelve un entero uniforme en [0, n): por defecto
 * `crypto.randomInt`, que no tiene sesgo de módulo.
 */
export function generarCodigo(aleatorio: (n: number) => number = randomInt): string {
  let codigo = '';
  for (let i = 0; i < LONGITUD_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[aleatorio(ALFABETO_CODIGO.length)];
  }
  return codigo;
}

/**
 * Lo que alguien teclea del ticket: sin espacios alrededor y en mayúsculas. Nada más: no se
 * "corrige" una O por un 0 (el alfabeto no tiene ninguno de los dos).
 */
export function normalizarCodigo(texto: string): string {
  return texto.trim().toUpperCase();
}

export function esCodigoValido(texto: string): boolean {
  return REGEX_CODIGO.test(texto);
}

/** La regla de vigencia de una empresa (sin configuración = fin de mes). */
export type VigenciaCodigos = { regla: 'fin_de_mes' } | { regla: 'dias'; dias: number };
export const VIGENCIA_DEFAULT: VigenciaCodigos = { regla: 'fin_de_mes' };
export const DIAS_VIGENCIA_MIN = 1;
export const DIAS_VIGENCIA_MAX = 366;

const pad = (n: number, largo = 2) => String(n).padStart(largo, '0');

/**
 * Cuándo deja de servir el código de un cheque cerrado en `cerradoAt`. El instante que devuelve
 * es EXCLUSIVO (a partir de él, expirado) y se corta en la zona de la SUCURSAL, no en la del
 * servidor:
 * - `fin_de_mes`: el primer instante del mes siguiente al del cierre (hora local).
 * - `dias` (N): el primer instante del día local `cierre + N + 1`, o sea "hasta el final del día N".
 *
 * Una zona inválida lanza (`RangeError` de `Intl`): el que llama decide (la ingesta lo aísla en
 * su savepoint y el cheque se guarda igual).
 */
export function expiracionDe(cerradoAt: Date, zona: string, vigencia: VigenciaCodigos): Date {
  const [a, m, d] = fechaLocal(cerradoAt, zona).slice(0, 10).split('-').map(Number);
  let dia: string;
  if (vigencia.regla === 'fin_de_mes') {
    dia = m === 12 ? `${a + 1}-01-01` : `${a}-${pad(m + 1)}-01`;
  } else {
    if (
      !Number.isInteger(vigencia.dias) ||
      vigencia.dias < DIAS_VIGENCIA_MIN ||
      vigencia.dias > DIAS_VIGENCIA_MAX
    ) {
      throw new RangeError(`Días de vigencia fuera de rango: ${vigencia.dias}`);
    }
    dia = new Date(Date.UTC(a, m - 1, d + vigencia.dias + 1)).toISOString().slice(0, 10);
  }
  const instante = instanteDesdeLocal(`${dia}T00:00:00`, zona);
  if (instante === null) {
    throw new RangeError(`No se pudo calcular la expiración en la zona ${zona}`);
  }
  return instante;
}

/**
 * ¿Este cheque lleva código? Cerrado, no cancelado y con total mayor que cero.
 * DECISION PROVISIONAL (nocturno): se supone que "cerrado" en SR ya es "cobrado y facturable",
 * que una cuenta cancelada no se factura y que una en $0 (cortesía total) tampoco. Nada de esto
 * se ha visto en una instalación real (docs/esquema-sr.md §2, F2-190).
 */
export function esFacturable(cheque: {
  cerradoAt: Date | null;
  cancelado: boolean;
  total: Prisma.Decimal;
}): boolean {
  return cheque.cerradoAt !== null && !cheque.cancelado && cheque.total.greaterThan(0);
}

/** Lo que responde el endpoint público: el estado guardado más `cancelado`, que se deriva. */
export type EstadoPublico = EstadoCodigoFacturacion | 'cancelado';

/**
 * El estado que se le dice al público, en este orden:
 * 1. `facturado` / `en_global` guardados mandan (ya hay un CFDI detrás).
 * 2. Cheque cancelado → `cancelado`. DECISION PROVISIONAL (nocturno): se DERIVA del cheque y no
 *    se guarda (no está en el enum de la ficha); si SR cancela la cuenta después de emitir el
 *    código, la fila del código no cambia (docs/esquema-sr.md §2).
 * 3. `expirado` guardado, o `ahora >= expira_at` → `expirado`. Se deriva al leer: ningún cron
 *    tiene que correr para que un código diga la verdad.
 * 4. Si no, `pendiente`.
 */
export function estadoPublico(
  codigo: { estado: EstadoCodigoFacturacion; expiraAt: Date },
  cheque: { cancelado: boolean },
  ahoraMs: number,
): EstadoPublico {
  if (codigo.estado === 'facturado' || codigo.estado === 'en_global') return codigo.estado;
  if (cheque.cancelado) return 'cancelado';
  if (codigo.estado === 'expirado' || ahoraMs >= codigo.expiraAt.getTime()) return 'expirado';
  return 'pendiente';
}

/** Mensaje en español por estado, para el portal (F2-103). Ninguno lleva datos del ticket. */
export const MENSAJE_ESTADO: Readonly<Record<EstadoPublico, string>> = {
  pendiente: 'El ticket se puede facturar.',
  facturado: 'Este ticket ya fue facturado.',
  en_global: 'Este ticket ya se incluyó en la factura global del periodo y no se puede facturar.',
  expirado: 'El plazo para facturar este ticket ya venció.',
  cancelado: 'La cuenta de este ticket fue cancelada y no se puede facturar.',
};

/** El punto de azar de la ingesta. Un provider para que los e2e fuercen colisiones y fallas. */
@Injectable()
export class GeneradorCodigo {
  generar(): string {
    return generarCodigo();
  }
}
