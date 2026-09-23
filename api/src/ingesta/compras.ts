import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { TOLERANCIA_FUTURO_MS } from './dto/catalogos.dto';
import { CompraDto, type RechazoCompraDto } from './dto/compras.dto';
import { valorDe } from './existencias';
import { cantidad, dinero, fechaUtc, jsonCanonico } from './normalizar';

/**
 * La parte PURA de la ingesta de compras (F2-126): validar cada compra del lote con todas sus
 * partidas, calcular sus importes, su total y su hash canónico, y decidir qué hacer frente a lo
 * guardado. Calcada de `movimientos.ts` (F2-122). Sin base de datos: la escritura vive en
 * `scope/escritura-compras.ts`.
 */

type D = Prisma.Decimal;

/** El tope de NUMERIC(12,2): el total de una compra tiene que caber. */
const TOPE_NUMERIC_12_2 = new Prisma.Decimal('10000000000');

export interface PartidaCompraNormalizada {
  renglon: number;
  insumoOrigenSrId: string;
  cantidad: D;
  costoUnitario: D;
  importe: D;
}

export interface CompraNormalizada {
  indice: number;
  origenSrId: string;
  folio: string;
  proveedorOrigenSrId: string | null;
  almacenOrigenSrId: string | null;
  fecha: Date;
  cancelada: boolean;
  partidas: PartidaCompraNormalizada[];
  /** Σ importes de las partidas, SIN IVA (supuesto de esquema-sr §10). */
  total: D;
  hash: string;
}

/** "0.00" sin signo. */
const sinCeroNegativo = (v: D): D => (v.isZero() ? new Prisma.Decimal(0) : v);

/**
 * La forma canónica de una compra, en texto: fecha a milisegundos en UTC, cantidades con 3
 * decimales e importes con 2, partidas en su orden. La cumplen lo que llega y lo que se guardó.
 */
export function hashCompra(c: Omit<CompraNormalizada, 'indice' | 'hash' | 'total'>): string {
  const canonico = jsonCanonico({
    origenSrId: c.origenSrId,
    folio: c.folio,
    proveedorOrigenSrId: c.proveedorOrigenSrId,
    almacenOrigenSrId: c.almacenOrigenSrId,
    fecha: c.fecha.toISOString(),
    cancelada: c.cancelada,
    partidas: c.partidas.map((x) => [
      x.renglon,
      x.insumoOrigenSrId,
      x.cantidad.toFixed(3),
      x.costoUnitario.toFixed(2),
      x.importe.toFixed(2),
    ]),
  });
  return createHash('sha256').update(canonico).digest('hex');
}

/** La ruta y la regla de cada error, SIN el valor. */
function motivos(errores: ValidationError[], prefijo: string): string[] {
  return errores.flatMap((e) => {
    const ruta = `${prefijo}.${e.property}`;
    const propios = Object.values(e.constraints ?? {}).map((m) => `${ruta}: ${m}`);
    return [...propios, ...motivos(e.children ?? [], ruta)];
  });
}

/** El `origenSrId` de la compra si es un texto válido (1–64), aunque el resto sea inválido. */
export function origenCompra(plano: unknown): string | null {
  if (plano !== null && typeof plano === 'object') {
    const v = (plano as { origenSrId?: unknown }).origenSrId;
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}

/** Cuántas partidas trae el lote EN TOTAL (lo que no es arreglo cuenta 0: lo rechaza su compra). */
export function partidasDeCompras(compras: readonly unknown[]): number {
  return compras.reduce<number>((n, c) => {
    const partidas =
      c !== null && typeof c === 'object' ? (c as { partidas?: unknown }).partidas : undefined;
    return n + (Array.isArray(partidas) ? partidas.length : 0);
  }, 0);
}

type Resultado = { ok: true; c: CompraNormalizada } | { ok: false; rechazo: RechazoCompraDto };

async function normalizarCompra(
  plano: unknown,
  indice: number,
  ahoraMs: number,
): Promise<Resultado> {
  const origen = origenCompra(plano);
  const rechazo = (motivo: string): Resultado => ({
    ok: false,
    rechazo: { indice, origenSrId: origen, motivo, reintentable: false },
  });
  const instancia = plainToInstance(CompraDto, plano);
  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errores.length > 0) {
    return rechazo(motivos(errores, `compras.${indice}`).join('; '));
  }
  const fecha = fechaUtc(instancia.fecha);
  if (Number.isNaN(fecha.getTime())) {
    return rechazo(`compras.${indice}.fecha: no es una fecha válida`);
  }
  if (fecha.getTime() > ahoraMs + TOLERANCIA_FUTURO_MS) {
    return rechazo(`compras.${indice}.fecha: más de 5 minutos en el futuro`);
  }
  const partidas: PartidaCompraNormalizada[] = [];
  let total = new Prisma.Decimal(0);
  for (const [renglon, x] of instancia.partidas.entries()) {
    const ruta = `compras.${indice}.partidas.${renglon}`;
    const cant = cantidad(x.cantidad);
    if (!cant.greaterThan(0)) {
      return rechazo(`${ruta}.cantidad: debe ser mayor que 0`);
    }
    const costo = dinero(x.costoUnitario);
    if (costo === null) {
      return rechazo(`${ruta}.costoUnitario: no cabe en NUMERIC(12,2) al redondear`);
    }
    if (costo.isNegative() && !costo.isZero()) {
      return rechazo(`${ruta}.costoUnitario: no puede ser negativo`);
    }
    const importe = valorDe(cant, costo);
    if (importe === null) {
      return rechazo(`${ruta}: cantidad × costoUnitario no cabe en NUMERIC(12,2)`);
    }
    total = total.plus(importe);
    partidas.push({
      renglon,
      insumoOrigenSrId: x.insumoOrigenSrId,
      cantidad: cant,
      costoUnitario: sinCeroNegativo(costo),
      importe,
    });
  }
  if (!total.lessThan(TOPE_NUMERIC_12_2)) {
    return rechazo(`compras.${indice}: el total no cabe en NUMERIC(12,2)`);
  }
  const c = {
    origenSrId: instancia.origenSrId,
    folio: instancia.folio,
    proveedorOrigenSrId: instancia.proveedorOrigenSrId ?? null,
    almacenOrigenSrId: instancia.almacenOrigenSrId ?? null,
    fecha,
    cancelada: instancia.cancelada,
    partidas,
  };
  return { ok: true, c: { ...c, indice, total, hash: hashCompra(c) } };
}

export interface LoteComprasNormalizado {
  validas: CompraNormalizada[];
  rechazos: RechazoCompraDto[];
}

/**
 * Valida el lote compra por compra. Una partida inválida rechaza SU compra entera. Un
 * `origenSrId` que aparece más de una vez se rechaza en TODAS sus apariciones.
 */
export async function normalizarLoteCompras(
  compras: readonly unknown[],
  ahoraMs: number,
): Promise<LoteComprasNormalizado> {
  const resultados = await Promise.all(compras.map((c, i) => normalizarCompra(c, i, ahoraMs)));
  const apariciones = new Map<string, number>();
  for (const c of compras) {
    const o = origenCompra(c);
    if (o !== null) apariciones.set(o, (apariciones.get(o) ?? 0) + 1);
  }
  const validas: CompraNormalizada[] = [];
  const rechazos: RechazoCompraDto[] = [];
  for (const r of resultados) {
    if (!r.ok) {
      rechazos.push(r.rechazo);
    } else if ((apariciones.get(r.c.origenSrId) ?? 0) > 1) {
      rechazos.push({
        indice: r.c.indice,
        origenSrId: r.c.origenSrId,
        motivo: `compras.${r.c.indice}.origenSrId: repetido en el lote`,
        reintentable: false,
      });
    } else {
      validas.push(r.c);
    }
  }
  rechazos.sort((a, b) => a.indice - b.indice);
  return { validas, rechazos };
}

/** Lo que se necesita de una compra guardada para decidir. */
export interface CompraGuardada {
  id: string;
  origenSrId: string;
  hash: string;
  leidaAt: Date;
}

export type DecisionCompra =
  | { accion: 'crear'; c: CompraNormalizada }
  | { accion: 'reemplazar'; id: string; c: CompraNormalizada }
  /** Mismo contenido, lectura más nueva: sólo avanza `leida_at`. */
  | { accion: 'avanzar_lectura'; id: string }
  | { accion: 'sin_cambios' }
  | { accion: 'obsoleta' };

/**
 * Qué hacer con una compra válida frente a la guardada (la regla de `decidirPoliza`, F2-122):
 * sin guardada → crear; guardada leída DESPUÉS → obsoleta; mismo hash → nada (o sólo avanzar la
 * lectura); hash distinto con lectura igual o más nueva → reemplazar. DECISION PROVISIONAL
 * (nocturno): con el MISMO `leidoAt` gana el que llega después.
 */
export function decidirCompra(
  guardada: CompraGuardada | undefined,
  c: CompraNormalizada,
  leidoAt: Date,
): DecisionCompra {
  if (!guardada) return { accion: 'crear', c };
  if (leidoAt < guardada.leidaAt) return { accion: 'obsoleta' };
  if (guardada.hash === c.hash) {
    return leidoAt > guardada.leidaAt
      ? { accion: 'avanzar_lectura', id: guardada.id }
      : { accion: 'sin_cambios' };
  }
  return { accion: 'reemplazar', id: guardada.id, c };
}
