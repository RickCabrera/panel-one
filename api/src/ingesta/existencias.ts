import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { RegistroExistenciaDto, type RechazoExistenciaDto } from './dto/existencias.dto';
import { cantidad, dinero } from './normalizar';

/**
 * La parte PURA de la ingesta de existencias (F2-121): validar cada registro de la foto de un
 * almacén, calcular su valor y decidir qué hacer frente a lo que ya hay. Sin base de datos: la
 * escritura vive en `scope/escritura-existencias.ts`.
 */

type D = Prisma.Decimal;

export interface ExistenciaNormalizada {
  indice: number;
  insumoOrigenSrId: string;
  cantidad: D;
  costoPromedio: D;
  valor: D;
}

/** El primer valor que ya no cabe en NUMERIC(12,2). */
const TOPE_NUMERIC_12_2 = new Prisma.Decimal('1e10');

/**
 * `round(cantidad × costo, 2)` mitad lejos de cero (`ROUND_HALF_UP` de decimal.js, igual que
 * NUMERIC de Postgres), o `null` si no cabe en NUMERIC(12,2). Todo en Decimal: nunca un float.
 */
export function valorDe(cant: D, costo: D): D | null {
  const v = cant.times(costo).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!v.abs().lessThan(TOPE_NUMERIC_12_2)) {
    return null;
  }
  // "-0.00" y "0.00" son el mismo valor: se guarda el cero sin signo.
  return v.isZero() ? new Prisma.Decimal(0) : v;
}

/** La ruta y la regla de cada error, SIN el valor. */
function motivos(errores: ValidationError[], prefijo: string): string[] {
  return errores.flatMap((e) => {
    const ruta = `${prefijo}.${e.property}`;
    const propios = Object.values(e.constraints ?? {}).map((m) => `${ruta}: ${m}`);
    return [...propios, ...motivos(e.children ?? [], ruta)];
  });
}

/** El `insumoOrigenSrId` del registro si es un texto válido (1–64), aunque el resto sea inválido. */
function insumoDe(plano: unknown): string | null {
  if (plano !== null && typeof plano === 'object') {
    const v = (plano as { insumoOrigenSrId?: unknown }).insumoOrigenSrId;
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}

type Resultado =
  { ok: true; r: ExistenciaNormalizada } | { ok: false; rechazo: RechazoExistenciaDto };

async function normalizarRegistro(plano: unknown, indice: number): Promise<Resultado> {
  const insumo = insumoDe(plano);
  const rechazo = (motivo: string): Resultado => ({
    ok: false,
    rechazo: { indice, insumoOrigenSrId: insumo, motivo, reintentable: false },
  });
  const instancia = plainToInstance(RegistroExistenciaDto, plano);
  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errores.length > 0) {
    return rechazo(motivos(errores, `registros.${indice}`).join('; '));
  }
  // DECISION PROVISIONAL (nocturno): el costo promedio es dinero y se redondea a 2 decimales
  // ANTES de valuar, como todo importe de §13. Si SR valúa con 4, F2-193 lo mide (esquema-sr §10).
  const costo = dinero(instancia.costoPromedio);
  if (costo === null) {
    return rechazo(`registros.${indice}.costoPromedio: no cabe en NUMERIC(12,2) al redondear`);
  }
  const cant = cantidad(instancia.cantidad);
  const valor = valorDe(cant, costo);
  if (valor === null) {
    return rechazo(`registros.${indice}: cantidad × costoPromedio no cabe en NUMERIC(12,2)`);
  }
  return {
    ok: true,
    r: {
      indice,
      insumoOrigenSrId: instancia.insumoOrigenSrId,
      cantidad: cant,
      // "-0.00" → "0.00": un reenvío idéntico no debe parecer un cambio.
      costoPromedio: costo.isZero() ? new Prisma.Decimal(0) : costo,
      valor,
    },
  };
}

export interface FotoNormalizada {
  validos: ExistenciaNormalizada[];
  rechazos: RechazoExistenciaDto[];
}

/**
 * Valida la foto registro por registro. Un `insumoOrigenSrId` que aparece más de una vez se
 * rechaza en TODAS sus apariciones: no se adivina cuál vale.
 */
export async function normalizarFoto(registros: readonly unknown[]): Promise<FotoNormalizada> {
  const resultados = await Promise.all(registros.map((r, i) => normalizarRegistro(r, i)));
  const apariciones = new Map<string, number>();
  for (const r of registros) {
    const o = insumoDe(r);
    if (o !== null) {
      apariciones.set(o, (apariciones.get(o) ?? 0) + 1);
    }
  }
  const validos: ExistenciaNormalizada[] = [];
  const rechazos: RechazoExistenciaDto[] = [];
  for (const r of resultados) {
    if (!r.ok) {
      rechazos.push(r.rechazo);
    } else if ((apariciones.get(r.r.insumoOrigenSrId) ?? 0) > 1) {
      rechazos.push({
        indice: r.r.indice,
        insumoOrigenSrId: r.r.insumoOrigenSrId,
        motivo: `registros.${r.r.indice}.insumoOrigenSrId: repetido en la foto`,
        reintentable: false,
      });
    } else {
      validos.push(r.r);
    }
  }
  rechazos.sort((a, b) => a.indice - b.indice);
  return { validos, rechazos };
}

/** Lo que se necesita de una fila guardada del almacén para decidir. */
export interface ExistenciaGuardada {
  id: string;
  insumoOrigenSrId: string;
  cantidad: D;
  costoPromedio: D;
  valor: D;
}

export interface PlanFoto {
  crear: ExistenciaNormalizada[];
  actualizar: Array<{ id: string; r: ExistenciaNormalizada }>;
  sinCambios: number;
  /** Ids de filas del almacén que ya no vienen en la foto. */
  borrar: string[];
  /** Rechazados cuya fila existía: se quedan como estaban. */
  conservados: number;
  /** Algún rechazo sin insumo identificable: esta foto no borra ausentes. */
  ausentesConservados: boolean;
}

/**
 * Qué hacer con la foto de un almacén frente a sus filas guardadas:
 * - sin fila → crear; cantidad, costo o valor distintos → actualizar; iguales → nada.
 * - rechazado con insumo identificable → su fila (si la hay) se conserva tal cual.
 * - fila que no viene en la foto → se borra (DECISION PROVISIONAL (nocturno): una foto VACÍA
 *   vacía el almacén, como `total = 0` en catálogos), SALVO que algún rechazo no tenga insumo
 *   identificable. DECISION PROVISIONAL (nocturno): en ese caso no se sabe si el ausente era el
 *   rechazado, y lo conservador es no borrar nada (esquema-sr.md §10).
 */
export function decidirFoto(op: {
  existentes: readonly ExistenciaGuardada[];
  validos: readonly ExistenciaNormalizada[];
  rechazos: readonly RechazoExistenciaDto[];
}): PlanFoto {
  const porInsumo = new Map(op.existentes.map((f) => [f.insumoOrigenSrId, f]));
  const plan: PlanFoto = {
    crear: [],
    actualizar: [],
    sinCambios: 0,
    borrar: [],
    conservados: 0,
    ausentesConservados: op.rechazos.some((r) => r.insumoOrigenSrId === null),
  };
  const vistos = new Set<string>();
  for (const r of op.validos) {
    vistos.add(r.insumoOrigenSrId);
    const f = porInsumo.get(r.insumoOrigenSrId);
    if (!f) {
      plan.crear.push(r);
    } else if (
      !f.cantidad.equals(r.cantidad) ||
      !f.costoPromedio.equals(r.costoPromedio) ||
      !f.valor.equals(r.valor)
    ) {
      plan.actualizar.push({ id: f.id, r });
    } else {
      plan.sinCambios++;
    }
  }
  for (const r of op.rechazos) {
    if (r.insumoOrigenSrId === null || vistos.has(r.insumoOrigenSrId)) continue;
    vistos.add(r.insumoOrigenSrId);
    if (porInsumo.has(r.insumoOrigenSrId)) plan.conservados++;
  }
  if (!plan.ausentesConservados) {
    plan.borrar = op.existentes.filter((f) => !vistos.has(f.insumoOrigenSrId)).map((f) => f.id);
  }
  return plan;
}

/** ¿El plan escribe algo? Sin cambios, un reenvío idéntico no mueve ni la lectura. */
export function hayCambios(plan: PlanFoto): boolean {
  return plan.crear.length + plan.actualizar.length + plan.borrar.length > 0;
}
