import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { RecetaDto, type RechazoRecetaDto } from './dto/recetas.dto';
import { jsonCanonico } from './normalizar';

/**
 * La parte PURA de la ingesta de recetas (F2-125): validar cada receta del lote con todos sus
 * renglones, ordenarlos en su forma canónica, calcular su hash y decidir qué hacer frente a lo
 * guardado. Sin base de datos: la escritura vive en `scope/escritura-recetas.ts`.
 */

type D = Prisma.Decimal;

export interface RenglonNormalizado {
  /** Posición CANÓNICA (tras ordenar), no la del lote. */
  renglon: number;
  insumoOrigenSrId: string;
  cantidad: D;
}

export interface RecetaNormalizada {
  indice: number;
  productoOrigenSrId: string;
  renglones: RenglonNormalizado[];
  hash: string;
}

/**
 * El orden canónico de los renglones: por insumo (texto, por code unit, sin depender del locale)
 * y, dentro del mismo insumo, por cantidad comparada como DECIMAL (no como texto: "0.05" < "0.1").
 * Así la misma receta leída en otro orden es el mismo contenido (el lector no tiene que ordenar).
 */
export function ordenCanonico(
  a: { insumoOrigenSrId: string; cantidad: D },
  b: { insumoOrigenSrId: string; cantidad: D },
): number {
  if (a.insumoOrigenSrId !== b.insumoOrigenSrId) {
    return a.insumoOrigenSrId < b.insumoOrigenSrId ? -1 : 1;
  }
  return a.cantidad.comparedTo(b.cantidad);
}

/** La forma canónica en texto: producto y renglones ordenados, cantidades a 4 decimales. */
export function hashReceta(r: Pick<RecetaNormalizada, 'productoOrigenSrId' | 'renglones'>): string {
  const canonico = jsonCanonico({
    productoOrigenSrId: r.productoOrigenSrId,
    renglones: r.renglones.map((x) => [x.renglon, x.insumoOrigenSrId, x.cantidad.toFixed(4)]),
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

/** El `productoOrigenSrId` de la receta si es un texto válido (1–64), aunque el resto no lo sea. */
export function productoDe(plano: unknown): string | null {
  if (plano !== null && typeof plano === 'object') {
    const v = (plano as { productoOrigenSrId?: unknown }).productoOrigenSrId;
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}

/** Cuántos renglones trae el lote EN TOTAL (lo que no es arreglo cuenta 0: lo rechaza su receta). */
export function renglonesDelLote(recetas: readonly unknown[]): number {
  return recetas.reduce<number>((n, r) => {
    const renglones =
      r !== null && typeof r === 'object' ? (r as { renglones?: unknown }).renglones : undefined;
    return n + (Array.isArray(renglones) ? renglones.length : 0);
  }, 0);
}

type Resultado = { ok: true; r: RecetaNormalizada } | { ok: false; rechazo: RechazoRecetaDto };

async function normalizarReceta(plano: unknown, indice: number): Promise<Resultado> {
  const producto = productoDe(plano);
  const instancia = plainToInstance(RecetaDto, plano);
  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errores.length > 0) {
    return {
      ok: false,
      rechazo: {
        indice,
        productoOrigenSrId: producto,
        motivo: motivos(errores, `recetas.${indice}`).join('; '),
        reintentable: false,
      },
    };
  }
  const renglones = instancia.renglones
    .map((x) => ({
      insumoOrigenSrId: x.insumoOrigenSrId,
      cantidad: new Prisma.Decimal(x.cantidad),
    }))
    .sort(ordenCanonico)
    .map((x, renglon) => ({ renglon, ...x }));
  const r = { productoOrigenSrId: instancia.productoOrigenSrId, renglones };
  return { ok: true, r: { ...r, indice, hash: hashReceta(r) } };
}

export interface LoteNormalizado {
  validas: RecetaNormalizada[];
  rechazos: RechazoRecetaDto[];
}

/**
 * Valida el lote receta por receta. Un renglón inválido rechaza SU receta entera. Un producto que
 * aparece más de una vez se rechaza en TODAS sus apariciones: no se adivina cuál vale.
 */
export async function normalizarLoteRecetas(recetas: readonly unknown[]): Promise<LoteNormalizado> {
  const resultados = await Promise.all(recetas.map((r, i) => normalizarReceta(r, i)));
  const apariciones = new Map<string, number>();
  for (const r of recetas) {
    const p = productoDe(r);
    if (p !== null) apariciones.set(p, (apariciones.get(p) ?? 0) + 1);
  }
  const validas: RecetaNormalizada[] = [];
  const rechazos: RechazoRecetaDto[] = [];
  for (const x of resultados) {
    if (!x.ok) {
      rechazos.push(x.rechazo);
    } else if ((apariciones.get(x.r.productoOrigenSrId) ?? 0) > 1) {
      rechazos.push({
        indice: x.r.indice,
        productoOrigenSrId: x.r.productoOrigenSrId,
        motivo: `recetas.${x.r.indice}.productoOrigenSrId: repetido en el lote`,
        reintentable: false,
      });
    } else {
      validas.push(x.r);
    }
  }
  rechazos.sort((a, b) => a.indice - b.indice);
  return { validas, rechazos };
}

/** Lo que se necesita de una receta guardada para decidir. */
export interface RecetaGuardada {
  id: string;
  productoOrigenSrId: string;
  hash: string;
  leidaAt: Date;
}

export type Decision =
  | { accion: 'crear'; r: RecetaNormalizada }
  | { accion: 'reemplazar'; id: string; r: RecetaNormalizada }
  /** Mismo contenido, lectura más nueva: sólo avanza `leida_at` (nada visible cambia). */
  | { accion: 'avanzar_lectura'; id: string }
  | { accion: 'sin_cambios' }
  | { accion: 'obsoleta' };

/**
 * Qué hacer con una receta válida frente a la guardada (la misma regla que las pólizas, F2-122):
 * sin guardada → crear; guardada leída DESPUÉS de este lote → obsoleta; mismo hash → nada (o sólo
 * avanza `leida_at`); hash distinto → reemplazar sus renglones. DECISION PROVISIONAL (nocturno):
 * con el MISMO `leidoAt` gana el que llega después (esquema-sr §10 "Recetas").
 */
export function decidirReceta(
  guardada: RecetaGuardada | undefined,
  r: RecetaNormalizada,
  leidoAt: Date,
): Decision {
  if (!guardada) return { accion: 'crear', r };
  if (leidoAt < guardada.leidaAt) return { accion: 'obsoleta' };
  if (guardada.hash === r.hash) {
    return leidoAt > guardada.leidaAt
      ? { accion: 'avanzar_lectura', id: guardada.id }
      : { accion: 'sin_cambios' };
  }
  return { accion: 'reemplazar', id: guardada.id, r };
}
