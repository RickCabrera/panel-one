import { ConflictException } from '@nestjs/common';
import { Prisma, RolUsuario } from '@prisma/client';

import { fechaLocal } from '../comun/fechas';
import {
  limitesDe,
  saldoFolios,
  UMBRAL_POR_DEFECTO,
  type PaqueteFolios,
  type SaldoFolios,
} from '../facturacion/folios';
import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * El control de folios del PAC (F2-110), parte del helper obligatorio de scope. El saldo es de la
 * PLATAFORMA (la cuenta de Facturama multiemisor), así que contarlo cruza empresas: esta pieza es
 * la ÚNICA que lee `paquetes_folios`, `configuracion_folios` y los conteos de `cfdis` de TODAS las
 * empresas, y la única que los escribe.
 *
 * - Hacia los caminos de un tenant (las cuatro reservas de CFDI y el `disponible()` del portal)
 *   sale SÓLO un booleano (`hayFoliosEnTx`, `hayFolios`): nunca filas, cifras ni `empresa_id`.
 * - Las cifras (`estado`, `consumo`, `reporteMensual`, `destinatariosAvisos`) y TODA escritura
 *   exigen scope `global` y LANZAN con otro: es un error de programación, no un 404.
 */

const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 15_000;
const ESPERA_CONEXION_MS = 5000;

type Tx = Prisma.TransactionClient;

export interface ClienteFolios {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function enTransaccion<T>(cliente: ClienteFolios, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return cliente.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
      return fn(tx);
    },
    { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
  );
}

function exigirGlobal(scope: EmpresaScope, que: string): void {
  if (scope.tipo !== 'global') {
    throw new Error(`${que}: el control de folios es de la plataforma y exige scope global.`);
  }
}

interface ConfigFolios {
  umbralPct: number;
  controlActivo: boolean;
  avisoUmbralAt: Date | null;
}

async function configuracion(tx: Tx, candado: boolean): Promise<ConfigFolios> {
  const filas = candado
    ? await tx.$queryRaw<
        { umbral_pct: number; control_activo: boolean; aviso_umbral_at: Date | null }[]
      >`SELECT umbral_pct, control_activo, aviso_umbral_at FROM configuracion_folios WHERE id = 1 FOR UPDATE`
    : await tx.$queryRaw<
        { umbral_pct: number; control_activo: boolean; aviso_umbral_at: Date | null }[]
      >`SELECT umbral_pct, control_activo, aviso_umbral_at FROM configuracion_folios WHERE id = 1`;
  const f = filas[0];
  // La migración crea la fila; si alguien la borró, el control se comporta como recién instalado.
  if (!f) return { umbralPct: UMBRAL_POR_DEFECTO, controlActivo: false, avisoUmbralAt: null };
  return {
    umbralPct: f.umbral_pct,
    controlActivo: f.control_activo,
    avisoUmbralAt: f.aviso_umbral_at,
  };
}

export type PaqueteGuardado = PaqueteFolios & { nota: string | null; avisoVigenciaAt: Date | null };

async function paquetes(tx: Tx): Promise<PaqueteGuardado[]> {
  return tx.paqueteFolios.findMany({
    select: {
      id: true,
      cantidad: true,
      compradoAt: true,
      venceAt: true,
      nota: true,
      avisoVigenciaAt: true,
    },
    orderBy: [{ compradoAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Timbres por cubo de `width_bucket` sobre los límites de los paquetes, sólo desde la primera
 * compra (lo anterior a todo paquete no es sobregiro: el control no existía). Nunca carga filas.
 */
async function conteosPorCubo(tx: Tx, limites: readonly Date[]): Promise<number[]> {
  const conteos = new Array<number>(limites.length + 1).fill(0);
  if (limites.length === 0) return conteos;
  const filas = await tx.$queryRaw<{ cubo: number; n: number }[]>`
    SELECT width_bucket(emitido_at, ${limites.map((d) => d.toISOString())}::timestamptz[]) AS cubo,
           count(*)::int AS n
    FROM cfdis
    WHERE estado IN ('vigente', 'cancelado')
      AND emitido_at >= ${limites[0]}
    GROUP BY 1`;
  for (const f of filas) conteos[Number(f.cubo)] = Number(f.n);
  return conteos;
}

async function enEmision(tx: Tx): Promise<number> {
  const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM cfdis WHERE estado = 'timbrando'`;
  return Number(n);
}

async function saldoEn(tx: Tx, ahora: Date, candado: boolean) {
  const config = await configuracion(tx, candado);
  const lista = await paquetes(tx);
  const limites = limitesDe(lista);
  const saldo = saldoFolios({
    control: config.controlActivo,
    umbralPct: config.umbralPct,
    paquetes: lista,
    limites,
    conteos: await conteosPorCubo(tx, limites),
    enEmision: await enEmision(tx),
    ahora,
  });
  return { config, lista, saldo };
}

/**
 * ¿Se puede apartar un folio más? Con el CANDADO GLOBAL (`configuracion_folios` FOR UPDATE) dentro
 * de la transacción de la reserva: serializa las reservas de todas las empresas mientras dura esa
 * transacción corta, para que dos reservas simultáneas no tomen el mismo último folio. Lo llama
 * `EscrituraFacturacion` DESPUÉS de sus candados de dominio (código / CFDI anterior) y ANTES del
 * UPDATE de `perfiles_fiscales`: ese orden es el mismo en las cuatro reservas.
 *
 * Con el control apagado no se toma el candado ni se cuenta nada: `true`.
 */
export async function hayFoliosEnTx(tx: Tx, ahora: Date): Promise<boolean> {
  const sinCandado = await configuracion(tx, false);
  if (!sinCandado.controlActivo) return true;
  const { saldo } = await saldoEn(tx, ahora, true);
  return !saldo.control || saldo.disponible > 0;
}

/** Una fila del conteo por mes: empresa × mes LOCAL de la sucursal que emitió. */
export interface ConteoMensual {
  empresaId: string;
  empresa: string;
  /** `AAAA-MM` en la zona de la sucursal del CFDI. */
  mes: string;
  vigentes: number;
  cancelados: number;
  /** Por origen; los sustitutos (refacturaciones) van aparte de su origen. */
  ticket: number;
  manual: number;
  global: number;
  sustitutos: number;
}

type FilaMes = Omit<ConteoMensual, 'empresa'> & { empresa: string; zona: string };

/**
 * Los timbres (vigentes + cancelados) por empresa, zona y mes local, emitidos en `[desde, hasta)`.
 * El MES es el de `emitido_at` en la zona de la SUCURSAL del CFDI, como el tablero de F2-106. Es la
 * ÚNICA consulta del reporte y de la tarjeta de consumo: las dos cuadran por construcción.
 */
async function porMes(tx: Tx, desde: Date, hasta: Date): Promise<FilaMes[]> {
  const filas = await tx.$queryRaw<
    {
      empresa_id: string;
      empresa: string;
      zona: string;
      mes: string;
      vigentes: number;
      cancelados: number;
      ticket: number;
      manual: number;
      global_: number;
      sustitutos: number;
    }[]
  >`
    SELECT c.empresa_id::text AS empresa_id, e.nombre AS empresa, s.zona_horaria AS zona,
           to_char(c.emitido_at AT TIME ZONE s.zona_horaria, 'YYYY-MM') AS mes,
           count(*) FILTER (WHERE c.estado = 'vigente')::int AS vigentes,
           count(*) FILTER (WHERE c.estado = 'cancelado')::int AS cancelados,
           count(*) FILTER (WHERE c.sustituye_a_id IS NULL AND c.origen = 'ticket')::int AS ticket,
           count(*) FILTER (WHERE c.sustituye_a_id IS NULL AND c.origen = 'manual')::int AS manual,
           count(*) FILTER (WHERE c.sustituye_a_id IS NULL AND c.origen = 'global')::int AS global_,
           count(*) FILTER (WHERE c.sustituye_a_id IS NOT NULL)::int AS sustitutos
    FROM cfdis c
    JOIN sucursales s ON s.id = c.sucursal_id AND s.empresa_id = c.empresa_id
    JOIN empresas e ON e.id = c.empresa_id
    WHERE c.estado IN ('vigente', 'cancelado')
      AND c.emitido_at >= ${desde}
      AND c.emitido_at < ${hasta}
    GROUP BY 1, 2, 3, 4`;
  return filas.map((f) => ({
    empresaId: f.empresa_id,
    empresa: f.empresa,
    zona: f.zona,
    mes: f.mes,
    vigentes: Number(f.vigentes),
    cancelados: Number(f.cancelados),
    ticket: Number(f.ticket),
    manual: Number(f.manual),
    global: Number(f.global_),
    sustitutos: Number(f.sustitutos),
  }));
}

const CAMPOS_CONTEO = [
  'vigentes',
  'cancelados',
  'ticket',
  'manual',
  'global',
  'sustitutos',
] as const;

function sumarPorEmpresaMes(filas: readonly FilaMes[]): ConteoMensual[] {
  const acc = new Map<string, ConteoMensual>();
  for (const f of filas) {
    const llave = `${f.empresaId}|${f.mes}`;
    const a = acc.get(llave) ?? {
      empresaId: f.empresaId,
      empresa: f.empresa,
      mes: f.mes,
      vigentes: 0,
      cancelados: 0,
      ticket: 0,
      manual: 0,
      global: 0,
      sustitutos: 0,
    };
    for (const c of CAMPOS_CONTEO) a[c] += f[c];
    acc.set(llave, a);
  }
  return [...acc.values()].sort(
    (x, y) => x.mes.localeCompare(y.mes) || x.empresa.localeCompare(y.empresa, 'es'),
  );
}

/** `AAAA-MM` → el mes anterior o siguiente. */
function moverMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Holgura para acotar por instante un rango de meses LOCALES de cualquier zona de México (±14 h). */
const HOLGURA_MS = 2 * 86_400_000;

export interface ConsumoEmpresa {
  empresaId: string;
  empresa: string;
  /** Timbres del mes en curso (mes local de cada sucursal). */
  mesActual: number;
  /** Timbres de los 12 meses locales que terminan en el mes en curso de cada sucursal. */
  ultimos12Meses: number;
}

/** Las lecturas del control de folios. Construida SÓLO por `ScopedPrismaService.folios(scope)`. */
export class LecturaFoliosPlataforma {
  readonly #cliente: ClienteFolios;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteFolios, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  /** Para el portal (`disponible()`): el mismo juicio que la reserva, sin candado. Un booleano. */
  hayFolios(ahora: Date): Promise<boolean> {
    return enTransaccion(this.#cliente, async (tx) => {
      const { saldo } = await saldoEn(tx, ahora, false);
      return !saldo.control || saldo.disponible > 0;
    });
  }

  /** El saldo completo, con sus paquetes. Sólo scope global. */
  estado(ahora: Date): Promise<SaldoFolios<PaqueteGuardado> & { avisoUmbralAt: Date | null }> {
    exigirGlobal(this.#scope, 'estado de folios');
    return enTransaccion(this.#cliente, async (tx) => {
      const { config, saldo } = await saldoEn(tx, ahora, false);
      return { ...saldo, avisoUmbralAt: config.avisoUmbralAt };
    });
  }

  /**
   * El reporte mensual de timbres por empresa, de `desde` a `hasta` (meses `AAAA-MM`, inclusive),
   * con el mes LOCAL de la sucursal de cada CFDI. Sólo scope global.
   */
  reporteMensual(desde: string, hasta: string): Promise<ConteoMensual[]> {
    exigirGlobal(this.#scope, 'reporte de folios');
    return enTransaccion(this.#cliente, async (tx) => {
      const inicio = new Date(Date.parse(`${desde}-01T00:00:00Z`) - HOLGURA_MS);
      const fin = new Date(Date.parse(`${moverMes(hasta, 1)}-01T00:00:00Z`) + HOLGURA_MS);
      const filas = (await porMes(tx, inicio, fin)).filter((f) => f.mes >= desde && f.mes <= hasta);
      return sumarPorEmpresaMes(filas);
    });
  }

  /**
   * Timbres por empresa en el mes en curso y en los últimos 12 meses, con el mes en curso de CADA
   * sucursal (su zona) y la MISMA consulta que el reporte. Sólo scope global.
   */
  consumoPorEmpresa(ahora: Date): Promise<ConsumoEmpresa[]> {
    exigirGlobal(this.#scope, 'consumo de folios');
    return enTransaccion(this.#cliente, async (tx) => {
      const mesUtc = ahora.toISOString().slice(0, 7);
      const inicio = new Date(Date.parse(`${moverMes(mesUtc, -12)}-01T00:00:00Z`) - HOLGURA_MS);
      const fin = new Date(Date.parse(`${moverMes(mesUtc, 1)}-01T00:00:00Z`) + HOLGURA_MS);
      const acc = new Map<string, ConsumoEmpresa>();
      for (const f of await porMes(tx, inicio, fin)) {
        const actual = fechaLocal(ahora, f.zona).slice(0, 7);
        const primero = moverMes(actual, -11);
        if (f.mes > actual || f.mes < primero) continue;
        const a = acc.get(f.empresaId) ?? {
          empresaId: f.empresaId,
          empresa: f.empresa,
          mesActual: 0,
          ultimos12Meses: 0,
        };
        const n = f.vigentes + f.cancelados;
        a.ultimos12Meses += n;
        if (f.mes === actual) a.mesActual += n;
        acc.set(f.empresaId, a);
      }
      return [...acc.values()].sort((x, y) => x.empresa.localeCompare(y.empresa, 'es'));
    });
  }

  /** A quién se le avisa: los admin_global activos. Sólo scope global. */
  destinatariosAvisos(): Promise<Array<{ email: string; nombre: string }>> {
    exigirGlobal(this.#scope, 'destinatarios de avisos de folios');
    return enTransaccion(this.#cliente, (tx) =>
      tx.usuario.findMany({
        where: whereScoped(this.#scope, 'Usuario', { rol: RolUsuario.admin_global, activo: true }),
        select: { email: true, nombre: true },
        orderBy: { email: 'asc' },
      }),
    );
  }
}

export const MENSAJE_PAQUETE_CON_CONSUMO =
  'Ese paquete ya tiene timbres asignados: borrarlo reescribiría el historial del saldo. Sólo se ' +
  'puede borrar un paquete que todavía no se ha usado.';

/** Las escrituras del control de folios. SÓLO scope global; construida por `ScopedPrismaService`. */
export class EscrituraFolios {
  readonly #cliente: ClienteFolios;

  constructor(cliente: ClienteFolios, scope: EmpresaScope) {
    exigirGlobal(scope, 'escritura de folios');
    this.#cliente = cliente;
  }

  /** Registra un paquete y PRENDE el control (no se vuelve a apagar solo). Devuelve su id. */
  altaPaquete(
    p: { cantidad: number; compradoAt: Date; venceAt: Date; nota: string | null },
    ahora: Date,
  ): Promise<string> {
    return enTransaccion(this.#cliente, async (tx) => {
      await configuracion(tx, true);
      const { id } = await tx.paqueteFolios.create({
        data: {
          cantidad: p.cantidad,
          compradoAt: p.compradoAt,
          venceAt: p.venceAt,
          nota: p.nota,
          createdAt: ahora,
        },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE configuracion_folios SET control_activo = true, updated_at = ${ahora} WHERE id = 1`;
      return id;
    });
  }

  /**
   * Borra un paquete SIN consumo (404 si no existe, 409 si ya tiene timbres asignados). Bajo el
   * candado global: una reserva simultánea no puede asignarle un timbre mientras se decide.
   */
  bajaPaquete(id: string, ahora: Date): Promise<void> {
    return enTransaccion(this.#cliente, async (tx) => {
      const { saldo } = await saldoEn(tx, ahora, true);
      const p = encontradoOr404(saldo.paquetes.find((x) => x.id === id));
      if (p.consumidos > 0) throw new ConflictException(MENSAJE_PAQUETE_CON_CONSUMO);
      await tx.paqueteFolios.delete({ where: { id } });
    });
  }

  async guardarUmbral(umbralPct: number, ahora: Date): Promise<void> {
    await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE configuracion_folios SET umbral_pct = ${umbralPct}, updated_at = ${ahora} WHERE id = 1`,
    );
  }

  /** Reclama el aviso de umbral: `true` sólo para quien lo ganó (dos vueltas → un correo). */
  async reclamarAvisoUmbral(ahora: Date): Promise<boolean> {
    const n = await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE configuracion_folios SET aviso_umbral_at = ${ahora}
        WHERE id = 1 AND aviso_umbral_at IS NULL`,
    );
    return n === 1;
  }

  /** Suelta un reclamo cuyo correo falló: la vuelta siguiente lo reintenta. */
  async soltarAvisoUmbral(marca: Date): Promise<void> {
    await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE configuracion_folios SET aviso_umbral_at = NULL
        WHERE id = 1 AND aviso_umbral_at = ${marca}`,
    );
  }

  /** El saldo volvió a estar bien: el siguiente cruce del umbral vuelve a avisar. */
  async rearmarAvisoUmbral(): Promise<void> {
    await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE configuracion_folios SET aviso_umbral_at = NULL
        WHERE id = 1 AND aviso_umbral_at IS NOT NULL`,
    );
  }

  async reclamarAvisoVigencia(id: string, ahora: Date): Promise<boolean> {
    const n = await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE paquetes_folios SET aviso_vigencia_at = ${ahora}
        WHERE id = ${id}::uuid AND aviso_vigencia_at IS NULL`,
    );
    return n === 1;
  }

  async soltarAvisoVigencia(id: string, marca: Date): Promise<void> {
    await enTransaccion(
      this.#cliente,
      (tx) =>
        tx.$executeRaw`
        UPDATE paquetes_folios SET aviso_vigencia_at = NULL
        WHERE id = ${id}::uuid AND aviso_vigencia_at = ${marca}`,
    );
  }
}
