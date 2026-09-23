import { createHash } from 'node:crypto';

import type { EstadoCodigoFacturacion, Prisma } from '@prisma/client';

import {
  ALFABETO_CODIGO,
  esFacturable,
  expiracionDe,
  LONGITUD_CODIGO,
  type VigenciaCodigos,
} from '../src/facturacion/codigo';
import { uuidDe } from './seed-alertas';

/**
 * Códigos cortos de facturación del seed (F2-101), PUROS y deterministas: un código por cheque
 * facturable (cerrado, no cancelado, total > 0), como los dejaría la ingesta.
 *
 * - El código sale de un SHA-256 de (cheque, intento): 45 bits por código, así que dos corridas
 *   del seed sobre sucursales distintas (la demo y las fixtures de los tests) no chocan en la
 *   unique global. Dentro de una corrida, un `Set` descarta repetidos y prueba el siguiente
 *   intento.
 * - ~15 % quedan `facturado` (también por hash). Los de meses anteriores quedan `pendiente`
 *   guardado y se leen `expirado` por su `expira_at` (el estado público se deriva al leer).
 *   `en_global` no se siembra: es de F2-108.
 * - `ejemplo` (opcional): el último cheque facturable de esa sucursal que siga vigente a las
 *   `ahora` lleva ese código y queda `pendiente`. El código entra al `Set` ANTES que los demás,
 *   así que ningún otro lo repite. Si ningún cheque de la sucursal está vigente, TRUENA: sembrar
 *   el ejemplo como expirado sin avisar dejaría el portal de demo sin ticket.
 * - `created_at` / `updated_at` = cierre del cheque: re-sembrar deja las filas idénticas.
 */

export const PORCENTAJE_FACTURADO = 15;

export interface ChequeParaCodigo {
  id: string;
  sucursalId: string;
  empresaId: string;
  cerradoAt: Date | null;
  cancelado: boolean;
  total: Prisma.Decimal;
}

export interface OpcionesCodigos {
  /** Zona IANA de cada sucursal, por id. */
  zonas: ReadonlyMap<string, string>;
  vigencia: VigenciaCodigos;
  ahora: Date;
  ejemplo?: { sucursalId: string; codigo: string };
}

export interface CodigoSeed {
  id: string;
  codigo: string;
  chequeId: string;
  sucursalId: string;
  empresaId: string;
  estado: EstadoCodigoFacturacion;
  expiraAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function bytes(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

/** El código determinista de un cheque en su intento `n` (32 símbolos: 5 bits por byte). */
export function codigoDeterminista(chequeId: string, n: number): string {
  const h = bytes(`codigo-facturacion:${chequeId}:${n}`);
  let codigo = '';
  for (let i = 0; i < LONGITUD_CODIGO; i++) codigo += ALFABETO_CODIGO[h[i] & 31];
  return codigo;
}

export function generarCodigosSeed(
  cheques: readonly ChequeParaCodigo[],
  op: OpcionesCodigos,
): CodigoSeed[] {
  const facturables = cheques.filter((c) => esFacturable(c));
  const expira = new Map(
    facturables.map((c) => {
      const zona = op.zonas.get(c.sucursalId);
      if (!zona) throw new Error(`Seed de códigos: falta la zona de la sucursal ${c.sucursalId}.`);
      return [c.id, expiracionDe(c.cerradoAt!, zona, op.vigencia)] as const;
    }),
  );

  let chequeEjemplo: string | null = null;
  const usados = new Set<string>();
  if (op.ejemplo) {
    const { sucursalId, codigo } = op.ejemplo;
    const vigentes = facturables
      .filter(
        (c) => c.sucursalId === sucursalId && expira.get(c.id)!.getTime() > op.ahora.getTime(),
      )
      .sort((a, b) => b.cerradoAt!.getTime() - a.cerradoAt!.getTime() || (a.id < b.id ? -1 : 1));
    if (vigentes.length === 0) {
      throw new Error(
        `Seed de códigos: ningún cheque facturable de la sucursal ${sucursalId} sigue vigente a ` +
          `las ${op.ahora.toISOString()}, y el código de ejemplo ${codigo} quedaría expirado. ` +
          'Corre el seed más tarde (o con SEED_AHORA) cuando ya haya cuentas cerradas este mes.',
      );
    }
    chequeEjemplo = vigentes[0].id;
    usados.add(codigo);
  }

  return facturables.map((c) => {
    let codigo: string;
    if (c.id === chequeEjemplo) {
      codigo = op.ejemplo!.codigo;
    } else {
      let n = 0;
      do codigo = codigoDeterminista(c.id, n++);
      while (usados.has(codigo));
      usados.add(codigo);
    }
    const facturado =
      c.id !== chequeEjemplo && bytes(`facturado:${c.id}`)[0] % 100 < PORCENTAJE_FACTURADO;
    return {
      id: uuidDe(`codigo-facturacion:${c.id}`),
      codigo,
      chequeId: c.id,
      sucursalId: c.sucursalId,
      empresaId: c.empresaId,
      estado: facturado ? 'facturado' : 'pendiente',
      expiraAt: expira.get(c.id)!,
      createdAt: c.cerradoAt!,
      updatedAt: c.cerradoAt!,
    };
  });
}
