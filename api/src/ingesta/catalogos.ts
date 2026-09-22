import { createHash } from 'node:crypto';

import type { CatalogoSr } from '@prisma/client';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import {
  RegistroCatalogoDto,
  RegistroClienteDto,
  RegistroProductoDto,
  type RechazoRegistroDto,
} from './dto/catalogos.dto';
import { jsonCanonico } from './normalizar';

/**
 * La parte PURA de la ingesta de catálogos (F2-230): validar y normalizar cada registro,
 * su hash, y decidir qué hacer con una página frente a lo que ya hay. Sin base de datos:
 * la escritura vive en `scope/escritura-catalogos.ts`.
 */

export const CATALOGOS: readonly CatalogoSr[] = [
  'grupos',
  'productos',
  'meseros',
  'clientes',
  'areas',
  'canales',
];

/**
 * ¿Sigue pendiente una solicitud de sincronización? Sí mientras algún catálogo de los seis
 * no haya RECIBIDO un cierre (reloj del API) después de la solicitud. Un cierre tomado antes
 * pero recibido después la da por atendida: desfase de relojes aceptado (F2-230).
 */
export function solicitudPendiente(
  solicitadaAt: Date | null,
  recibidas: ReadonlyArray<{ catalogo: CatalogoSr; recibidaAt: Date }>,
): boolean {
  if (solicitadaAt === null) {
    return false;
  }
  const porCatalogo = new Map(recibidas.map((r) => [r.catalogo, r.recibidaAt]));
  return CATALOGOS.some((c) => {
    const r = porCatalogo.get(c);
    return r === undefined || r < solicitadaAt;
  });
}

/** El contenido que se guarda (y se compara) de un registro, sin su llave ni sus marcas. */
export type Contenido = Record<string, string | boolean | null>;

export interface RegistroNormalizado {
  indice: number;
  origenSrId: string;
  contenido: Contenido;
  hash: string;
}

function claseDe(catalogo: CatalogoSr): ClassConstructor<RegistroCatalogoDto> {
  switch (catalogo) {
    case 'productos':
      return RegistroProductoDto;
    case 'clientes':
      return RegistroClienteDto;
    default:
      return RegistroCatalogoDto;
  }
}

/** Las columnas de contenido de cada catálogo, en orden. Todas nulables salvo `nombre`. */
export function columnasDe(catalogo: CatalogoSr): readonly string[] {
  const comunes = ['clave', 'nombre', 'activoPos'];
  switch (catalogo) {
    case 'productos':
      return [...comunes, 'grupoOrigenSrId'];
    case 'clientes':
      return [...comunes, 'telefono', 'correo', 'rfc'];
    default:
      return comunes;
  }
}

/** sha256 del JSON canónico del contenido (llaves ordenadas; ausente = null). */
export function hashContenido(contenido: Contenido): string {
  return createHash('sha256').update(jsonCanonico(contenido)).digest('hex');
}

/**
 * La ruta y la regla de cada error, SIN el valor: los clientes traen teléfono, correo y RFC,
 * y el motivo va al agente y al log. Los mensajes de class-validator no incluyen el valor
 * (no usamos `$value`); esto además descarta cualquier `constraint` que sí lo trajera.
 */
function motivos(errores: ValidationError[], prefijo: string): string[] {
  return errores.flatMap((e) => {
    const ruta = `${prefijo}.${e.property}`;
    const propios = Object.values(e.constraints ?? {}).map((m) => `${ruta}: ${m}`);
    return [...propios, ...motivos(e.children ?? [], ruta)];
  });
}

export type ResultadoRegistro =
  { ok: true; registro: RegistroNormalizado } | { ok: false; rechazo: RechazoRegistroDto };

/** Valida un registro con la clase de su catálogo y lo normaliza. */
export async function normalizarRegistro(
  catalogo: CatalogoSr,
  plano: unknown,
  indice: number,
): Promise<ResultadoRegistro> {
  const origen = origenDe(plano);
  const instancia = plainToInstance(claseDe(catalogo), plano);
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
        origenSrId: origen,
        motivo: motivos(errores, `registros.${indice}`).join('; '),
        reintentable: false,
      },
    };
  }
  const datos = instancia as unknown as Record<string, unknown>;
  const contenido: Contenido = {};
  for (const col of columnasDe(catalogo)) {
    const v = datos[col];
    contenido[col] = v === undefined ? null : (v as string | boolean | null);
  }
  return {
    ok: true,
    registro: {
      indice,
      origenSrId: instancia.origenSrId,
      contenido,
      hash: hashContenido(contenido),
    },
  };
}

/** El `origenSrId` del registro si es un texto válido (1–64), aunque el resto sea inválido. */
function origenDe(plano: unknown): string | null {
  if (plano !== null && typeof plano === 'object') {
    const v = (plano as { origenSrId?: unknown }).origenSrId;
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}

export interface PaginaNormalizada {
  validos: RegistroNormalizado[];
  rechazos: RechazoRegistroDto[];
}

/**
 * Valida la página registro por registro. Un `origenSrId` que aparece más de una vez se
 * rechaza en TODAS sus apariciones: no se adivina cuál vale.
 */
export async function normalizarPagina(
  catalogo: CatalogoSr,
  registros: readonly unknown[],
): Promise<PaginaNormalizada> {
  const resultados = await Promise.all(registros.map((r, i) => normalizarRegistro(catalogo, r, i)));
  const apariciones = new Map<string, number>();
  for (const r of registros) {
    const o = origenDe(r);
    if (o !== null) {
      apariciones.set(o, (apariciones.get(o) ?? 0) + 1);
    }
  }
  const validos: RegistroNormalizado[] = [];
  const rechazos: RechazoRegistroDto[] = [];
  for (const r of resultados) {
    if (!r.ok) {
      rechazos.push(r.rechazo);
    } else if ((apariciones.get(r.registro.origenSrId) ?? 0) > 1) {
      rechazos.push({
        indice: r.registro.indice,
        origenSrId: r.registro.origenSrId,
        motivo: `registros.${r.registro.indice}.origenSrId: repetido en la página`,
        reintentable: false,
      });
    } else {
      validos.push(r.registro);
    }
  }
  rechazos.sort((a, b) => a.indice - b.indice);
  return { validos, rechazos };
}

// ---------------------------------------------------------------------------
// decidir
// ---------------------------------------------------------------------------

/** Lo que se necesita de una fila guardada para decidir. */
export interface FilaExistente {
  id: string;
  origenSrId: string;
  hash: string;
  activo: boolean;
  vistoAt: Date;
  sincronizacionId: string;
}

export interface PlanPagina {
  crear: RegistroNormalizado[];
  actualizar: Array<{ id: string; registro: RegistroNormalizado }>;
  /** Filas a las que sólo se les mueven las marcas (`vistoAt`, `sincronizacionId`). */
  marcar: string[];
  sinCambios: number;
  obsoletos: number;
  vistos: number;
  rechazadosSinFila: number;
}

/**
 * Qué hacer con cada registro de una página, frente a las filas que ya hay:
 * - sin fila → crear;
 * - `capturadoAt` anterior a su `vistoAt` → obsoleto (una sincronización más nueva ya lo
 *   trajo: no se revierte);
 * - hash distinto o fila inactiva → actualizar contenido, reactivar y mover marcas;
 * - mismo hash y activa → sólo marcas si difieren; si no, nada (reenvío idéntico = cero
 *   escrituras). Nunca cambia `updatedAt`.
 * Un RECHAZADO cuya fila existe se marca visto (sin tocar contenido), salvo que su
 * `capturadoAt` sea anterior al `vistoAt` (las marcas nunca retroceden). Un rechazado sin
 * fila cuenta en `rechazadosSinFila` (cada aparición, menos una por fila existente).
 */
export function decidir(op: {
  existentes: readonly FilaExistente[];
  validos: readonly RegistroNormalizado[];
  rechazos: readonly RechazoRegistroDto[];
  capturadoAt: Date;
  sincronizacionId: string;
}): PlanPagina {
  const porOrigen = new Map(op.existentes.map((f) => [f.origenSrId, f]));
  const t = op.capturadoAt.getTime();
  const plan: PlanPagina = {
    crear: [],
    actualizar: [],
    marcar: [],
    sinCambios: 0,
    obsoletos: 0,
    vistos: 0,
    rechazadosSinFila: 0,
  };
  const marcasDistintas = (f: FilaExistente) =>
    f.vistoAt.getTime() !== t || f.sincronizacionId !== op.sincronizacionId;

  for (const r of op.validos) {
    const f = porOrigen.get(r.origenSrId);
    if (!f) {
      plan.crear.push(r);
    } else if (t < f.vistoAt.getTime()) {
      plan.obsoletos++;
    } else if (f.hash !== r.hash || !f.activo) {
      plan.actualizar.push({ id: f.id, registro: r });
    } else {
      if (marcasDistintas(f)) {
        plan.marcar.push(f.id);
      }
      plan.sinCambios++;
    }
  }

  const yaVistas = new Set<string>();
  for (const r of op.rechazos) {
    const f = r.origenSrId === null ? undefined : porOrigen.get(r.origenSrId);
    if (!f || yaVistas.has(f.id)) {
      plan.rechazadosSinFila++;
      continue;
    }
    yaVistas.add(f.id);
    plan.vistos++;
    if (t >= f.vistoAt.getTime() && marcasDistintas(f)) {
      plan.marcar.push(f.id);
    }
  }
  return plan;
}
