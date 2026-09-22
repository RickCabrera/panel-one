import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ISO_CON_ZONA } from '../comun/fechas';
import type { EmpresaScope } from './empresa-scope';

/**
 * SQL crudo de los agregados de ventas (F1-032), CON scope. Es parte del helper
 * obligatorio, no un atajo: sólo se obtiene con `ScopedPrismaService.ventas()`,
 * y el caller NO escribe el `FROM` de ninguna tabla real.
 *
 * El helper arma todo el prefijo `WITH`. Cada CTE ya trae el filtro de tenant
 * (el del usuario Y la empresa pedida), el de sucursal y el corte de fechas en
 * la zona de CADA sucursal. El caller sólo aporta el cuerpo, que lee de ellas:
 *
 * - `sucursales_alcance(id, empresa_id, nombre, zona_horaria)`
 * - `ventas(id, empresa_id, sucursal_id, folio, cerrado_at, hora_local,
 *   dia_local, comensales, subtotal, impuestos, descuentos, propina, total,
 *   recibido_at, mesa, mesero, abierto_at, dia_semana_local, segundos_abierta)`: cheques
 *   NO cancelados cerrados en el rango. `hora_local`, `dia_local` y `dia_semana_local`
 *   (ISO: 1 = lunes … 7 = domingo) son los del cierre en la zona de SU sucursal;
 *   `segundos_abierta` = cierre − apertura (F2-221; negativo si el POS los trae al revés).
 * - `cancelados(id, empresa_id, sucursal_id, folio, momento, recibido_at, mesero, total)`:
 *   cheques cancelados del rango, ubicados por `momento = COALESCE(cerrado_at, abierto_at)`.
 * - `tickets(id, empresa_id, sucursal_id, folio, momento, cancelado, recibido_at)`:
 *   la lista de tickets (F1-033) = `ventas` ∪ `cancelados`; `momento` es
 *   `cerrado_at` en los no cancelados.
 *
 * `recibido_at` es `cheques.created_at`: cuándo llegó el cheque a NUESTRA base
 * por primera vez (el upsert de la ingesta no lo reescribe). Sirve para el corte
 * del export de Tickets (F2-203); no es un dato de SR.
 * - `partidas_ventas(cheque_id, empresa_id, sucursal_id, producto, categoria,
 *   cantidad, total)`: partidas de `ventas`.
 * - `pagos_ventas(cheque_id, empresa_id, sucursal_id, forma_raw, monto)`.
 * - `catalogo_formas(empresa_id, forma_raw, forma)`: catálogo de la empresa.
 *
 * `guardiaCuerpo()` rechaza un cuerpo que intente leer otra cosa.
 */

export interface FiltroVentas {
  readonly empresaId: string;
  readonly sucursalId?: string;
  /** Día local de la sucursal, `YYYY-MM-DD`, inclusivo. */
  readonly desde: string;
  /** Día local de la sucursal, `YYYY-MM-DD`, inclusivo. */
  readonly hasta: string;
  /**
   * Corte "a la misma altura" (F2-220): un INSTANTE ISO con zona. En el ÚLTIMO día del
   * rango (`hasta`) sólo entra lo ocurrido ANTES de la hora local que marca ese instante
   * en la zona de CADA sucursal (corte exclusivo); los días anteriores van completos.
   * Así "la semana pasada hasta ahora" corta CDMX a las 14:00 y Tijuana a las 13:00 con
   * el mismo instante, que es lo que lleva cada una HOY. Sin él, el día va completo.
   *
   * DECISION PROVISIONAL (nocturno): sólo se usa la HORA local del instante, no su fecha. Con
   * sucursales en zonas distintas, en la hora en que el día local de una sucursal no es el del
   * panel (p. ej. Tijuana entre las 00:00 y la 01:00 de CDMX: allá sigue siendo ayer, 23:xx)
   * su base se corta a las 23:xx mientras su "hoy" vale 0, y el Δ sale muy bajo; con una zona
   * adelantada (Cancún) pasa al revés. Arreglo propuesto: comparar la fecha local del instante
   * con el día de referencia (posterior → último día completo, anterior → corte a las 00:00,
   * igual → a la hora local). Lo decide Ricardo (docs/nocturno-log.md, F2-220).
   */
  readonly alturaAl?: string;
}

/** Tiempo máximo de una consulta de agregados. Un agregado que tarda más es un bug. */
export const TIMEOUT_CONSULTA_MS = 5000;

/** El rango más largo que se acepta, en días (un año bisiesto completo). */
export const MAX_DIAS_RANGO = 366;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Los nombres que el cuerpo SÍ puede poner después de un FROM / JOIN. */
export const CTES_VENTAS = [
  'sucursales_alcance',
  'ventas',
  'cancelados',
  'partidas_ventas',
  'pagos_ventas',
  'catalogo_formas',
  'tickets',
] as const;

const HORA_ISO = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Un instante ISO con zona que existe de verdad: la forma de `ISO_CON_ZONA`, un día de
 * calendario real (`2026-02-30T…` no) y hora, minuto, segundo y offset en rango. No se
 * deja a `Date.parse`, que según el motor acepta o recorre fechas imposibles.
 */
function instanteValido(texto: unknown): boolean {
  if (typeof texto !== 'string' || !ISO_CON_ZONA.test(texto)) {
    return false;
  }
  const partes = HORA_ISO.exec(texto);
  if (dia(texto.slice(0, 10)) === null || !partes) {
    return false;
  }
  const [h, m, s] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  if (h > 23 || m > 59 || s > 59) {
    return false;
  }
  if (partes[4] !== undefined) {
    const [oh, om] = [Number(partes[5]), Number(partes[6])];
    if (oh > 14 || om > 59) {
      return false;
    }
  }
  return true;
}

/** Un día de calendario real, en ms UTC de su medianoche, o null. */
function dia(texto: unknown): number | null {
  if (typeof texto !== 'string') {
    return null;
  }
  const m = DIA.exec(texto);
  if (!m) {
    return null;
  }
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(a, mes - 1, d);
  const f = new Date(ms);
  // `Date.UTC(2026, 1, 30)` da 2 de marzo: el round-trip descarta días que no existen.
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/**
 * Valida el filtro ANTES de cualquier consulta (400). Así un id que no es UUID
 * no llega a Postgres como un error de cast que saldría 500.
 */
export function validarFiltro(filtro: FiltroVentas): void {
  const errores: string[] = [];
  if (typeof filtro.empresaId !== 'string' || !UUID.test(filtro.empresaId)) {
    errores.push('empresaId debe ser un UUID');
  }
  if (
    filtro.sucursalId !== undefined &&
    (typeof filtro.sucursalId !== 'string' || !UUID.test(filtro.sucursalId))
  ) {
    errores.push('sucursalId debe ser un UUID');
  }
  const desde = dia(filtro.desde);
  const hasta = dia(filtro.hasta);
  if (desde === null) {
    errores.push('desde debe ser una fecha YYYY-MM-DD válida');
  }
  if (hasta === null) {
    errores.push('hasta debe ser una fecha YYYY-MM-DD válida');
  }
  if (desde !== null && hasta !== null) {
    const dias = (hasta - desde) / 86_400_000 + 1;
    if (dias < 1) {
      errores.push('desde no puede ser posterior a hasta');
    } else if (dias > MAX_DIAS_RANGO) {
      errores.push(`el rango no puede pasar de ${MAX_DIAS_RANGO} días`);
    }
  }
  if (filtro.alturaAl !== undefined && !instanteValido(filtro.alturaAl)) {
    errores.push('alturaAl debe ser un instante ISO-8601 válido con zona (Z u offset ±hh:mm)');
  }
  if (errores.length > 0) {
    throw new BadRequestException(errores);
  }
}

/** Las tablas reales, sacadas del datamodel: un modelo nuevo queda prohibido solo. */
export function tablasReales(): string[] {
  const modelos = Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name);
  return [...modelos, '_prisma_migrations'];
}

const ESQUEMAS_DE_SISTEMA = /\b(public|pg_catalog|information_schema|pg_[a-z0-9_]*)\b/i;

/**
 * Rechaza un cuerpo que pueda leer algo fuera de las CTEs con scope. Mira sólo
 * el texto del SQL (`strings`), no los valores, que viajan como parámetros.
 *
 * - Ninguna tabla real (`tablasReales()`), en ninguna posición.
 * - Después de FROM / JOIN sólo puede ir una CTE, una subconsulta `(`, o
 *   `generate_series(`.
 * - Nada de identificadores entre comillas (`"cheques"`, `U&"..."`), esquemas
 *   (`public.`, `pg_catalog`), `;` ni comentarios.
 *
 * Es una red contra DESCUIDOS de nuestro propio código, no contra un atacante:
 * el cuerpo lo escribe siempre este repo y nunca viene del request (lo que sí
 * viene, viaja como parámetro). SQL dinámico armado adentro (p. ej. una cadena
 * concatenada dentro de `query_to_xml(...)`) la brincaría. Es conservadora a
 * propósito y rechaza SQL válido como `JOIN LATERAL (` o `extract(x FROM y)` en
 * el cuerpo: lo que haga falta de eso se calcula en las CTEs de aquí abajo.
 */
export function guardiaCuerpo(cuerpo: Prisma.Sql): void {
  const texto = cuerpo.strings.join(' ? ');
  const falla = (motivo: string): never => {
    throw new Error(`Consulta de ventas rechazada por el helper de scope: ${motivo}.`);
  };
  for (const tabla of tablasReales()) {
    if (new RegExp(`\\b${tabla}\\b`, 'i').test(texto)) {
      falla(`menciona la tabla real "${tabla}"; lee de las CTEs (${CTES_VENTAS.join(', ')})`);
    }
  }
  if (texto.includes('"')) {
    falla('identificadores entre comillas no permitidos');
  }
  if (/u&/i.test(texto)) {
    falla('identificadores con escapes unicode no permitidos');
  }
  if (ESQUEMAS_DE_SISTEMA.test(texto)) {
    falla('esquemas explícitos o catálogos del sistema no permitidos');
  }
  if (texto.includes(';')) {
    falla('más de una sentencia no permitida');
  }
  if (texto.includes('--') || texto.includes('/*')) {
    falla('comentarios no permitidos');
  }
  const permitidas = new Set<string>(CTES_VENTAS);
  for (const m of texto.matchAll(/\b(from|join)\s+([a-z_][a-z0-9_]*)?(\s*\()?/gi)) {
    const nombre = m[2]?.toLowerCase();
    const esLlamada = m[3] !== undefined;
    if (nombre === undefined) {
      if (!esLlamada) {
        falla(`"${m[1]}" sin una CTE después`);
      }
      continue; // subconsulta
    }
    if (esLlamada) {
      if (nombre !== 'generate_series') {
        falla(`función "${nombre}" no permitida después de ${m[1]}`);
      }
      continue;
    }
    if (!permitidas.has(nombre)) {
      falla(`"${nombre}" no es una CTE del helper (${CTES_VENTAS.join(', ')})`);
    }
  }
}

/** Ejecuta un SQL ya armado con timeout corto. Lo provee `ScopedPrismaService`. */
export type EjecutorSql = (sql: Prisma.Sql, timeoutMs: number) => Promise<unknown[]>;

/** `AND <alias>.empresa_id = <empresa del usuario>`, o nada para admin_global. */
function filtroTenant(scope: EmpresaScope, alias: string): Prisma.Sql {
  if (scope.tipo === 'global') {
    return Prisma.empty;
  }
  return Prisma.sql`AND ${Prisma.raw(alias)}.empresa_id = ${scope.empresaId}::uuid`;
}

/** Lo que devuelve `ScopedPrismaService.ventas(scope, filtro)`. */
export class ConsultaVentas {
  readonly #ejecutar: EjecutorSql;
  readonly #ctes: Prisma.Sql;

  constructor(ejecutar: EjecutorSql, scope: EmpresaScope, filtro: FiltroVentas) {
    validarFiltro(filtro);
    if (scope.tipo !== 'global' && scope.tipo !== 'empresa') {
      throw new Error('Scope desconocido: no se arma una consulta sin tenant.');
    }
    this.#ejecutar = ejecutar;
    this.#ctes = armarCtes(scope, filtro);
  }

  /** Corre `SELECT ...` sobre las CTEs con scope. `T` es la forma de cada fila. */
  async consultar<T>(cuerpo: Prisma.Sql): Promise<T[]> {
    guardiaCuerpo(cuerpo);
    const filas = await this.#ejecutar(Prisma.sql`${this.#ctes} ${cuerpo}`, TIMEOUT_CONSULTA_MS);
    return filas as T[];
  }
}

function armarCtes(scope: EmpresaScope, filtro: FiltroVentas): Prisma.Sql {
  const empresa = Prisma.sql`${filtro.empresaId}::uuid`;
  const sucursal =
    filtro.sucursalId === undefined
      ? Prisma.empty
      : Prisma.sql`AND s.id = ${filtro.sucursalId}::uuid`;
  // Inicio del primer día y fin (exclusivo) del último, EN LA ZONA DE CADA SUCURSAL.
  const inicioLocal = Prisma.sql`(${filtro.desde}::date::timestamp AT TIME ZONE s.zona_horaria)`;
  // Con `alturaAl` (F2-220), el último día termina en la hora local de ESE instante en la
  // zona de cada sucursal, no a medianoche. Sin él, el SQL es idéntico al de siempre.
  const finLocal =
    filtro.alturaAl === undefined
      ? Prisma.sql`((${filtro.hasta}::date + 1)::timestamp AT TIME ZONE s.zona_horaria)`
      : Prisma.sql`((${filtro.hasta}::date + (${filtro.alturaAl}::timestamptz AT TIME ZONE s.zona_horaria)::time)::timestamp AT TIME ZONE s.zona_horaria)`;
  // Pre-filtro grueso en UTC (las zonas van de -12 a +14 h) que sí puede usar
  // los índices `(empresa_id, cerrado_at)` / `(sucursal_id, cerrado_at)`. En
  // `cancelados` va partido en dos ramas (con y sin `cerrado_at`) porque el
  // `COALESCE` no es sargable; no cambia qué filas entran, sólo acota el escaneo.
  const inicioGrueso = Prisma.sql`((${filtro.desde}::date::timestamp AT TIME ZONE 'UTC') - interval '15 hours')`;
  const finGrueso = Prisma.sql`(((${filtro.hasta}::date + 1)::timestamp AT TIME ZONE 'UTC') + interval '15 hours')`;
  const sucursalCheque =
    filtro.sucursalId === undefined
      ? Prisma.empty
      : Prisma.sql`AND c.sucursal_id = ${filtro.sucursalId}::uuid`;

  return Prisma.sql`WITH sucursales_alcance AS (
    SELECT s.id, s.empresa_id, s.nombre, s.zona_horaria
    FROM sucursales s
    WHERE s.empresa_id = ${empresa} ${filtroTenant(scope, 's')} ${sucursal}
  ),
  ventas AS (
    SELECT c.id, c.empresa_id, c.sucursal_id, c.folio, c.cerrado_at,
           extract(hour FROM c.cerrado_at AT TIME ZONE s.zona_horaria)::int AS hora_local,
           (c.cerrado_at AT TIME ZONE s.zona_horaria)::date AS dia_local,
           c.comensales, c.subtotal, c.impuestos, c.descuentos, c.propina, c.total,
           c.created_at AS recibido_at,
           c.mesa, c.mesero, c.abierto_at,
           extract(isodow FROM c.cerrado_at AT TIME ZONE s.zona_horaria)::int AS dia_semana_local,
           extract(epoch FROM (c.cerrado_at - c.abierto_at))::int AS segundos_abierta
    FROM cheques c
    JOIN sucursales_alcance s ON s.id = c.sucursal_id AND s.empresa_id = c.empresa_id
    WHERE c.empresa_id = ${empresa} ${filtroTenant(scope, 'c')} ${sucursalCheque}
      AND NOT c.cancelado
      AND c.cerrado_at >= ${inicioGrueso} AND c.cerrado_at < ${finGrueso}
      AND c.cerrado_at >= ${inicioLocal} AND c.cerrado_at < ${finLocal}
  ),
  cancelados AS (
    SELECT c.id, c.empresa_id, c.sucursal_id, c.folio,
           COALESCE(c.cerrado_at, c.abierto_at) AS momento, c.created_at AS recibido_at,
           c.mesero, c.total
    FROM cheques c
    JOIN sucursales_alcance s ON s.id = c.sucursal_id AND s.empresa_id = c.empresa_id
    WHERE c.empresa_id = ${empresa} ${filtroTenant(scope, 'c')} ${sucursalCheque}
      AND c.cancelado
      AND (
        (c.cerrado_at >= ${inicioGrueso} AND c.cerrado_at < ${finGrueso})
        OR (c.cerrado_at IS NULL AND c.abierto_at >= ${inicioGrueso} AND c.abierto_at < ${finGrueso})
      )
      AND COALESCE(c.cerrado_at, c.abierto_at) >= ${inicioLocal}
      AND COALESCE(c.cerrado_at, c.abierto_at) < ${finLocal}
  ),
  partidas_ventas AS (
    SELECT p.cheque_id, p.empresa_id, v.sucursal_id, p.producto, p.categoria, p.cantidad, p.total
    FROM cheque_partidas p
    JOIN ventas v ON v.id = p.cheque_id AND v.empresa_id = p.empresa_id
    WHERE p.empresa_id = ${empresa} ${filtroTenant(scope, 'p')}
  ),
  pagos_ventas AS (
    SELECT g.cheque_id, g.empresa_id, v.sucursal_id, g.forma_raw, g.monto
    FROM cheque_pagos g
    JOIN ventas v ON v.id = g.cheque_id AND v.empresa_id = g.empresa_id
    WHERE g.empresa_id = ${empresa} ${filtroTenant(scope, 'g')}
  ),
  catalogo_formas AS (
    SELECT f.empresa_id, f.forma_raw, f.forma::text AS forma
    FROM formas_pago_catalogo f
    WHERE f.empresa_id = ${empresa} ${filtroTenant(scope, 'f')}
  ),
  tickets AS (
    SELECT id, empresa_id, sucursal_id, folio, cerrado_at AS momento, false AS cancelado,
           recibido_at FROM ventas
    UNION ALL
    SELECT id, empresa_id, sucursal_id, folio, momento, true AS cancelado,
           recibido_at FROM cancelados
  )`;
}
