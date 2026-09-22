import { createHash } from 'node:crypto';

import { Prisma, type TipoPolizaInventario } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { TOLERANCIA_FUTURO_MS } from './dto/catalogos.dto';
import { PolizaMovimientosDto, type RechazoPolizaDto } from './dto/movimientos.dto';
import { valorDe } from './existencias';
import { cantidad, dinero, fechaUtc, jsonCanonico } from './normalizar';

/**
 * La parte PURA de la ingesta de movimientos (F2-122): validar cada póliza del lote con todas
 * sus partidas, calcular sus importes y su hash canónico, y decidir qué hacer frente a lo
 * guardado. Sin base de datos: la escritura vive en `scope/escritura-movimientos.ts`.
 */

type D = Prisma.Decimal;

export interface PartidaNormalizada {
  renglon: number;
  insumoOrigenSrId: string;
  cantidad: D;
  costoUnitario: D;
  importe: D;
}

export interface PolizaNormalizada {
  indice: number;
  origenSrId: string;
  folio: string;
  tipo: TipoPolizaInventario;
  tipoSr: string | null;
  almacenOrigenSrId: string;
  fecha: Date;
  referencia: string | null;
  cancelada: boolean;
  partidas: PartidaNormalizada[];
  hash: string;
}

/** "-0.00" y "0.00" (o "-0.000") son el mismo valor: se guarda el cero sin signo. */
const sinCeroNegativo = (v: D): D => (v.isZero() ? new Prisma.Decimal(0) : v);

/**
 * La forma canónica de una póliza, en texto: fecha a milisegundos en UTC, cantidades con 3
 * decimales e importes con 2 (`"10.5"` y `"10.500"` son lo mismo), partidas en su orden. La
 * cumplen lo que llega y lo que se guardó, así las dos pasan por la MISMA función.
 */
export function hashPoliza(p: Omit<PolizaNormalizada, 'indice' | 'hash'>): string {
  const canonico = jsonCanonico({
    origenSrId: p.origenSrId,
    folio: p.folio,
    tipo: p.tipo,
    tipoSr: p.tipoSr,
    almacenOrigenSrId: p.almacenOrigenSrId,
    fecha: p.fecha.toISOString(),
    referencia: p.referencia,
    cancelada: p.cancelada,
    partidas: p.partidas.map((x) => [
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

/** El `origenSrId` de la póliza si es un texto válido (1–64), aunque el resto sea inválido. */
export function origenDe(plano: unknown): string | null {
  if (plano !== null && typeof plano === 'object') {
    const v = (plano as { origenSrId?: unknown }).origenSrId;
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}

/** Cuántas partidas trae el lote EN TOTAL (lo que no es arreglo cuenta 0: lo rechaza su póliza). */
export function partidasDelLote(polizas: readonly unknown[]): number {
  return polizas.reduce<number>((n, p) => {
    const partidas =
      p !== null && typeof p === 'object' ? (p as { partidas?: unknown }).partidas : undefined;
    return n + (Array.isArray(partidas) ? partidas.length : 0);
  }, 0);
}

type Resultado = { ok: true; p: PolizaNormalizada } | { ok: false; rechazo: RechazoPolizaDto };

async function normalizarPoliza(
  plano: unknown,
  indice: number,
  ahoraMs: number,
): Promise<Resultado> {
  const origen = origenDe(plano);
  const rechazo = (motivo: string): Resultado => ({
    ok: false,
    rechazo: { indice, origenSrId: origen, motivo, reintentable: false },
  });
  const instancia = plainToInstance(PolizaMovimientosDto, plano);
  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errores.length > 0) {
    return rechazo(motivos(errores, `polizas.${indice}`).join('; '));
  }
  const fecha = fechaUtc(instancia.fecha);
  if (Number.isNaN(fecha.getTime())) {
    return rechazo(`polizas.${indice}.fecha: no es una fecha válida`);
  }
  if (fecha.getTime() > ahoraMs + TOLERANCIA_FUTURO_MS) {
    return rechazo(`polizas.${indice}.fecha: más de 5 minutos en el futuro`);
  }
  const partidas: PartidaNormalizada[] = [];
  for (const [renglon, x] of instancia.partidas.entries()) {
    const ruta = `polizas.${indice}.partidas.${renglon}`;
    const costo = dinero(x.costoUnitario);
    if (costo === null) {
      return rechazo(`${ruta}.costoUnitario: no cabe en NUMERIC(12,2) al redondear`);
    }
    const cant = cantidad(x.cantidad);
    const importe = valorDe(cant, costo);
    if (importe === null) {
      return rechazo(`${ruta}: cantidad × costoUnitario no cabe en NUMERIC(12,2)`);
    }
    partidas.push({
      renglon,
      insumoOrigenSrId: x.insumoOrigenSrId,
      cantidad: sinCeroNegativo(cant),
      costoUnitario: sinCeroNegativo(costo),
      importe,
    });
  }
  const p = {
    origenSrId: instancia.origenSrId,
    folio: instancia.folio,
    tipo: instancia.tipo,
    tipoSr: instancia.tipoSr ?? null,
    almacenOrigenSrId: instancia.almacenOrigenSrId,
    fecha,
    referencia: instancia.referencia ?? null,
    cancelada: instancia.cancelada,
    partidas,
  };
  return { ok: true, p: { ...p, indice, hash: hashPoliza(p) } };
}

export interface LoteNormalizado {
  validas: PolizaNormalizada[];
  rechazos: RechazoPolizaDto[];
}

/**
 * Valida el lote póliza por póliza. Una partida inválida rechaza SU póliza entera. Un
 * `origenSrId` que aparece más de una vez se rechaza en TODAS sus apariciones: no se adivina
 * cuál vale.
 */
export async function normalizarLote(
  polizas: readonly unknown[],
  ahoraMs: number,
): Promise<LoteNormalizado> {
  const resultados = await Promise.all(polizas.map((p, i) => normalizarPoliza(p, i, ahoraMs)));
  const apariciones = new Map<string, number>();
  for (const p of polizas) {
    const o = origenDe(p);
    if (o !== null) apariciones.set(o, (apariciones.get(o) ?? 0) + 1);
  }
  const validas: PolizaNormalizada[] = [];
  const rechazos: RechazoPolizaDto[] = [];
  for (const r of resultados) {
    if (!r.ok) {
      rechazos.push(r.rechazo);
    } else if ((apariciones.get(r.p.origenSrId) ?? 0) > 1) {
      rechazos.push({
        indice: r.p.indice,
        origenSrId: r.p.origenSrId,
        motivo: `polizas.${r.p.indice}.origenSrId: repetido en el lote`,
        reintentable: false,
      });
    } else {
      validas.push(r.p);
    }
  }
  rechazos.sort((a, b) => a.indice - b.indice);
  return { validas, rechazos };
}

/** Lo que se necesita de una póliza guardada para decidir. */
export interface PolizaGuardada {
  id: string;
  origenSrId: string;
  hash: string;
  leidaAt: Date;
}

export type Decision =
  | { accion: 'crear'; p: PolizaNormalizada }
  | { accion: 'reemplazar'; id: string; p: PolizaNormalizada }
  /** Mismo contenido, lectura más nueva: sólo avanza `leida_at` (nada visible cambia). */
  | { accion: 'avanzar_lectura'; id: string }
  | { accion: 'sin_cambios' }
  | { accion: 'obsoleta' };

/**
 * Qué hacer con una póliza válida frente a la guardada:
 * - sin guardada → crear.
 * - guardada leída DESPUÉS de este lote → obsoleta: un lote viejo reintentado no revierte nada.
 * - mismo hash → nada (si la lectura es más nueva, sólo avanza `leida_at`, para que un lote más
 *   viejo que ESTE tampoco la revierta).
 * - hash distinto con lectura igual o más nueva → reemplazar cabecera y partidas. DECISION
 *   PROVISIONAL (nocturno): con el MISMO `leidoAt` gana el que llega después (esquema-sr §10).
 */
export function decidirPoliza(
  guardada: PolizaGuardada | undefined,
  p: PolizaNormalizada,
  leidoAt: Date,
): Decision {
  if (!guardada) return { accion: 'crear', p };
  if (leidoAt < guardada.leidaAt) return { accion: 'obsoleta' };
  if (guardada.hash === p.hash) {
    return leidoAt > guardada.leidaAt
      ? { accion: 'avanzar_lectura', id: guardada.id }
      : { accion: 'sin_cambios' };
  }
  return { accion: 'reemplazar', id: guardada.id, p };
}
