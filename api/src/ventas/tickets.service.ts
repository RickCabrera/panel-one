import { BadRequestException, Injectable } from '@nestjs/common';
import { FormaPago, Prisma, type EstadoEmisionCfdi } from '@prisma/client';

import { Reloj } from '../comun/reloj';
import {
  estadoPublico,
  mensajeEstado,
  periodoGlobalDe,
  type EstadoPublico,
  type GlobalDelCodigo,
} from '../facturacion/codigo';
import type { FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService, pesos } from './agregados-ventas.service';

export interface PartidaTicket {
  producto: string;
  categoria: string | null;
  cantidad: string;
  precioUnit: string;
  total: string;
  modificadores: unknown[];
}

export interface PagoTicket {
  formaRaw: string;
  forma: FormaPago;
  monto: string;
}

/**
 * El código de facturación del ticket (F2-103, el "Y además" 4 de F2-101): lo que la caja le
 * dicta al cliente si el ticket no se imprimió con el QR (respaldo de F2-102). `estado` es el
 * PÚBLICO (el mismo que ve el portal): `cancelado` y `expirado` se derivan al leer.
 */
export interface CodigoFacturacionTicket {
  codigo: string;
  estado: EstadoPublico;
  mensaje: string;
  /** F2-108: el periodo de la factura global, sólo con `en_global`. */
  periodoGlobal: string | null;
}

export interface Ticket {
  id: string;
  sucursalId: string;
  folio: string;
  mesa: string | null;
  mesero: string | null;
  comensales: number | null;
  abiertoAt: string;
  cerradoAt: string | null;
  cancelado: boolean;
  subtotal: string;
  impuestos: string;
  descuentos: string;
  propina: string;
  total: string;
  partidas: PartidaTicket[];
  pagos: PagoTicket[];
  /** Null = la cuenta no tiene código (no es facturable o llegó antes de F2-101). */
  codigoFacturacion: CodigoFacturacionTicket | null;
}

export interface PaginaTickets {
  items: Ticket[];
  total: number;
  pagina: number;
  porPagina: number;
  /**
   * Corte por recepción (ISO, ms, UTC): el pedido, que filtró esta página; o, sin
   * él, el que se SUGIERE mandar en las siguientes (esta página no se filtró).
   */
  corte: string;
}

export const CANCELADAS = ['incluir', 'excluir', 'solo'] as const;
export type Canceladas = (typeof CANCELADAS)[number];

export const ORDENES_TICKETS = [
  'momento',
  'folio',
  'total',
  'mesa',
  'mesero',
  'comensales',
  'propina',
  'duracion',
] as const;
export type OrdenTickets = (typeof ORDENES_TICKETS)[number];

export const DIRECCIONES = ['asc', 'desc'] as const;
export type Direccion = (typeof DIRECCIONES)[number];

/** Un importe de filtro: pesos con hasta 2 decimales, en texto (nunca float). */
export const IMPORTE_FILTRO = /^-?\d{1,10}(\.\d{1,2})?$/;

/**
 * Lista blanca de orden → expresión SQL FIJA (F2-222). Lo que viene del request sólo elige
 * una llave de aquí; jamás se interpola. Los textos van con `ucs_basic` (byte a byte, igual
 * en CI y en cualquier Postgres, como `analisis.service.ts`).
 * DECISION PROVISIONAL (nocturno): `folio` es texto (esquema-sr.md §2); se ordena por largo y
 * luego por texto para que "999" quede antes de "1000" si los folios son numéricos.
 */
const EXPRESION_ORDEN: Readonly<Record<OrdenTickets, readonly string[]>> = {
  momento: ['momento'],
  folio: ['length(folio)', 'folio COLLATE ucs_basic'],
  total: ['total'],
  mesa: ['mesa COLLATE ucs_basic'],
  mesero: ['mesero COLLATE ucs_basic'],
  comensales: ['comensales'],
  propina: ['propina'],
  duracion: ['(cerrado_at - abierto_at)'],
};
const SQL_DIRECCION: Readonly<Record<Direccion, string>> = { asc: 'ASC', desc: 'DESC' };

/** El `ORDER BY` de la página, sólo desde las listas blancas. Nulos al final; desempate por id. */
export function ordenSql(orden: OrdenTickets, dir: Direccion): Prisma.Sql {
  if (!Object.hasOwn(EXPRESION_ORDEN, orden) || !Object.hasOwn(SQL_DIRECCION, dir)) {
    throw new Error(`Orden de tickets fuera de la lista blanca: ${String(orden)} ${String(dir)}.`);
  }
  const sentido = SQL_DIRECCION[dir];
  const partes = EXPRESION_ORDEN[orden].map((e) => `${e} ${sentido} NULLS LAST`);
  return Prisma.raw(`ORDER BY ${[...partes, `id ${sentido}`].join(', ')}`);
}

export interface OpcionesTickets {
  pagina: number;
  porPagina: number;
  /** Prefijo literal del folio. */
  folio?: string;
  /** Instante ISO con zona: sólo tickets recibidos hasta él (F2-203). */
  corte?: string;
  /** Igualdad exacta (F2-222). */
  mesero?: string;
  /** Igualdad exacta (F2-222). */
  mesa?: string;
  /** Al menos un pago de esa forma, según el catálogo (F2-222). */
  forma?: FormaPago;
  /** `total >= importeMin`, texto decimal (F2-222). */
  importeMin?: string;
  /** `total <= importeMax`, texto decimal (F2-222). */
  importeMax?: string;
  /** Default `incluir` (F2-222). */
  canceladas?: Canceladas;
  /** Alguna partida cuyo producto contiene el texto, sin mayúsculas, literal (F2-222). */
  producto?: string;
  /** Id del espejo de clientes (F2-232); se resuelve con scope antes de filtrar. */
  clienteId?: string;
  /** Default `momento` / `desc` (F2-222). */
  orden?: OrdenTickets;
  dir?: Direccion;
}

/** min > max es un 400, comparado en decimal exacto (nunca `Number`). */
function validarImportes(opciones: OpcionesTickets): void {
  const { importeMin, importeMax } = opciones;
  for (const valor of [importeMin, importeMax]) {
    if (valor !== undefined && !IMPORTE_FILTRO.test(valor)) {
      throw new BadRequestException(['importe inválido']);
    }
  }
  if (
    importeMin !== undefined &&
    importeMax !== undefined &&
    new Prisma.Decimal(importeMin).greaterThan(new Prisma.Decimal(importeMax))
  ) {
    throw new BadRequestException(['importeMin no puede ser mayor que importeMax']);
  }
}

/** Las condiciones de F2-222 sobre la CTE `tickets` (alias `t`). Todo valor viaja como parámetro. */
function condicionesFiltro(opciones: OpcionesTickets): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  if (opciones.mesero !== undefined) c.push(Prisma.sql`t.mesero = ${opciones.mesero}`);
  if (opciones.mesa !== undefined) c.push(Prisma.sql`t.mesa = ${opciones.mesa}`);
  if (opciones.importeMin !== undefined) {
    c.push(Prisma.sql`t.total >= ${opciones.importeMin}::numeric`);
  }
  if (opciones.importeMax !== undefined) {
    c.push(Prisma.sql`t.total <= ${opciones.importeMax}::numeric`);
  }
  if (opciones.canceladas === 'excluir') c.push(Prisma.sql`NOT t.cancelado`);
  if (opciones.canceladas === 'solo') c.push(Prisma.sql`t.cancelado`);
  if (opciones.producto !== undefined) {
    // `strpos` y no LIKE: el texto es literal, sin comodines que escapar.
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM partidas_empresa pt
      WHERE pt.cheque_id = t.id AND pt.empresa_id = t.empresa_id
        AND strpos(lower(pt.producto), lower(${opciones.producto})) > 0)`);
  }
  if (opciones.forma !== undefined) {
    // El MISMO criterio que `pagos[].forma` del detalle: catálogo de la empresa, o `otro`.
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM pagos_empresa gt
      LEFT JOIN catalogo_formas cf ON cf.empresa_id = gt.empresa_id AND cf.forma_raw = gt.forma_raw
      WHERE gt.cheque_id = t.id AND gt.empresa_id = t.empresa_id
        AND COALESCE(cf.forma, ${FormaPago.otro}) = ${opciones.forma})`);
  }
  return c;
}

/**
 * Sin `corte` pedido, la página no se filtra por recepción (la lista normal ve
 * todo lo recibido) y el corte que se sugiere es "ahora − 30 s" según el reloj de
 * POSTGRES, el mismo que pone `created_at`. El margen es mayor que el timeout de
 * 5 s de la transacción de ingesta: una fila con `created_at` anterior al corte
 * ya está commiteada cuando el corte se calcula, así que repetir la consulta con
 * él no puede sumar a nadie.
 */
export const MARGEN_CORTE_S = 30;

/**
 * Lista paginada de tickets (F1-033) con su detalle, para la vista Tickets
 * (F1-042). Qué es un ticket del rango: la CTE `tickets` del helper de scope =
 * `ventas` ∪ `cancelados` (esquema-sr.md §2). Los cancelados salen con su flag
 * y no suman a nada.
 *
 * Dos pasos, los dos con scope:
 * 1. La página de ids y el total, en SQL sobre la CTE `tickets` (ya filtrada
 *    por tenant, empresa, sucursal y rango en la zona de cada sucursal).
 * 2. El detalle de esos ids con `para(scope).cheque.findMany`. Partidas y pagos
 *    están atados al cheque por FK compuesta `(cheque_id, empresa_id)`: no
 *    pueden ser de otra empresa.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly agregados: AgregadosVentasService,
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async listar(
    scope: EmpresaScope,
    filtro: FiltroVentas,
    opciones: OpcionesTickets,
  ): Promise<PaginaTickets> {
    const { pagina, porPagina, folio } = opciones;
    validarImportes(opciones);
    const orden = ordenSql(opciones.orden ?? 'momento', opciones.dir ?? 'desc');
    // Valida el filtro (400) y el alcance (404) igual que los agregados.
    const q = await this.agregados.consulta(scope, filtro);

    // Corte por RECEPCIÓN (F2-203): el export de Tickets baja decenas de páginas y,
    // en hora pico, un cheque que llega a media descarga movía el total y lo
    // abortaba. Con el mismo corte en todas las páginas, lo que llega después no
    // entra. Sólo filtra si se pide; sin él, se devuelve uno sugerido. Milisegundos, como `created_at` (`Timestamptz(3)`), para que el valor
    // que devolvemos vuelva idéntico.
    // DECISION PROVISIONAL (nocturno): el corte sólo congela los cheques que
    // LLEGAN. Uno que ya estaba y cambia de rango o de estado a media descarga (se
    // cancela, o se cierra si el agente manda cuentas abiertas, cosa que hoy nadie
    // sabe: docs/esquema-sr.md §2, "Corte por recepción") sigue moviendo el total,
    // y el export aborta en vez de entregar un archivo incompleto.
    const [{ corte }] =
      opciones.corte === undefined
        ? await q.consultar<{ corte: Date }>(
            Prisma.sql`SELECT date_trunc('milliseconds', now() - make_interval(secs => ${MARGEN_CORTE_S})) AS corte`,
          )
        : [{ corte: new Date(opciones.corte) }];

    // `starts_with` con el prefijo como parámetro: literal, sin comodines que escapar.
    const condiciones: Prisma.Sql[] = [];
    if (opciones.corte !== undefined) {
      condiciones.push(Prisma.sql`t.recibido_at <= ${corte.toISOString()}::timestamptz`);
    }
    if (folio !== undefined) {
      condiciones.push(Prisma.sql`starts_with(t.folio, ${folio})`);
    }
    // Filtros de F2-222: el MISMO `WHERE` para el conteo y la página, así `total` es siempre
    // el del filtro completo (la cifra que se muestra antes de exportar).
    condiciones.push(...condicionesFiltro(opciones));
    if (opciones.clienteId !== undefined) {
      condiciones.push(await this.condicionCliente(scope, filtro.empresaId, opciones.clienteId));
    }
    const donde =
      condiciones.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
    const [conteo] = await q.consultar<{ total: number }>(
      Prisma.sql`SELECT count(*)::int AS total FROM tickets t ${donde}`,
    );
    const pag = await q.consultar<{ id: string }>(
      Prisma.sql`SELECT id FROM tickets t ${donde}
        ${orden}
        LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
    );
    const base = { total: conteo.total, pagina, porPagina, corte: corte.toISOString() };
    if (pag.length === 0) {
      return { items: [], ...base };
    }

    const ids = pag.map((f) => f.id);
    const datos = this.datos.para(scope);
    const [cheques, catalogo] = await Promise.all([
      datos.cheque.findMany({
        where: { id: { in: ids }, empresaId: filtro.empresaId },
        include: {
          partidas: { orderBy: { orden: 'asc' } },
          pagos: { orderBy: { id: 'asc' } },
          // En la MISMA consulta con scope: la FK compuesta (cheque_id, empresa_id) ata el código
          // a la empresa del cheque.
          codigoFacturacion: {
            select: {
              codigo: true,
              estado: true,
              expiraAt: true,
              cfdi: { select: { estado: true } },
              // F2-108: la global en la que entró (su estado y su periodo) y la zona para decirlo.
              global: {
                select: {
                  cfdi: { select: { estado: true, globalPeriodicidad: true, globalDesde: true } },
                },
              },
              sucursal: { select: { zonaHoraria: true } },
            },
          },
        },
      }),
      datos.formaPagoCatalogo.findMany({
        where: { empresaId: filtro.empresaId },
        select: { formaRaw: true, forma: true },
      }),
    ]);
    const formas = new Map(catalogo.map((c) => [c.formaRaw, c.forma]));
    const ahora = this.reloj.ahora();
    const porId = new Map(cheques.map((c) => [c.id, c]));
    const items = ids.map((id) => {
      const c = porId.get(id);
      if (!c) {
        // Leídos en dos consultas: si el cheque cambió de rango o de empresa
        // entre las dos, es un error, no un hueco silencioso en la página.
        throw new Error(`El ticket ${id} de la página no se pudo leer con scope.`);
      }
      return {
        id: c.id,
        sucursalId: c.sucursalId,
        folio: c.folio,
        mesa: c.mesa,
        mesero: c.mesero,
        comensales: c.comensales,
        abiertoAt: c.abiertoAt.toISOString(),
        cerradoAt: c.cerradoAt?.toISOString() ?? null,
        cancelado: c.cancelado,
        subtotal: pesos(c.subtotal),
        impuestos: pesos(c.impuestos),
        descuentos: pesos(c.descuentos),
        propina: pesos(c.propina),
        total: pesos(c.total),
        partidas: c.partidas.map((p) => ({
          producto: p.producto,
          categoria: p.categoria,
          cantidad: p.cantidad.toFixed(3),
          precioUnit: pesos(p.precioUnit),
          total: pesos(p.total),
          modificadores: Array.isArray(p.modificadores) ? p.modificadores : [],
        })),
        pagos: c.pagos.map((g) => ({
          formaRaw: g.formaRaw,
          forma: formas.get(g.formaRaw) ?? FormaPago.otro,
          monto: pesos(g.monto),
        })),
        codigoFacturacion: c.codigoFacturacion
          ? codigoDelTicket(c.codigoFacturacion, c.cancelado, ahora)
          : null,
      };
    });
    return { items, ...base };
  }

  /**
   * F2-232: el cliente se resuelve en el espejo CON scope (empresa del filtro): uno ajeno o
   * inexistente es el mismo 404. Se filtra por los TRES datos del registro (empresa, sucursal
   * y su id en el POS), así el mismo `origen_sr_id` de otra sucursal nunca entra.
   */
  private async condicionCliente(
    scope: EmpresaScope,
    empresaId: string,
    clienteId: string,
  ): Promise<Prisma.Sql> {
    const cliente = encontradoOr404(
      await this.datos.para(scope).clienteCatalogo.findFirst({
        where: { id: clienteId, empresaId },
        select: { empresaId: true, sucursalId: true, origenSrId: true },
      }),
    );
    return Prisma.sql`(t.empresa_id = ${cliente.empresaId}::uuid
      AND t.sucursal_id = ${cliente.sucursalId}::uuid
      AND t.cliente_origen_sr_id = ${cliente.origenSrId})`;
  }
}

function codigoDelTicket(
  codigo: Parameters<typeof estadoPublico>[0] & {
    codigo: string;
    global: (GlobalDelCodigo & { cfdi: { estado: EstadoEmisionCfdi } }) | null;
    sucursal: { zonaHoraria: string };
  },
  cancelado: boolean,
  ahoraMs: number,
): CodigoFacturacionTicket {
  const estado = estadoPublico(codigo, { cancelado }, ahoraMs);
  const periodoGlobal = periodoGlobalDe(estado, codigo.global, codigo.sucursal.zonaHoraria);
  return {
    codigo: codigo.codigo,
    estado,
    mensaje: mensajeEstado(estado, periodoGlobal),
    periodoGlobal,
  };
}
