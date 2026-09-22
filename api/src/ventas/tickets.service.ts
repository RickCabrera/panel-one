import { Injectable } from '@nestjs/common';
import { FormaPago, Prisma } from '@prisma/client';

import type { FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
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

export interface OpcionesTickets {
  pagina: number;
  porPagina: number;
  /** Prefijo literal del folio. */
  folio?: string;
  /** Instante ISO con zona: sólo tickets recibidos hasta él (F2-203). */
  corte?: string;
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
  ) {}

  async listar(
    scope: EmpresaScope,
    filtro: FiltroVentas,
    opciones: OpcionesTickets,
  ): Promise<PaginaTickets> {
    const { pagina, porPagina, folio } = opciones;
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
      condiciones.push(Prisma.sql`recibido_at <= ${corte.toISOString()}::timestamptz`);
    }
    if (folio !== undefined) {
      condiciones.push(Prisma.sql`starts_with(folio, ${folio})`);
    }
    const donde =
      condiciones.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(condiciones, ' AND ')}`;
    const [conteo] = await q.consultar<{ total: number }>(
      Prisma.sql`SELECT count(*)::int AS total FROM tickets ${donde}`,
    );
    const pag = await q.consultar<{ id: string }>(
      Prisma.sql`SELECT id FROM tickets ${donde}
        ORDER BY momento DESC, id DESC
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
        include: { partidas: { orderBy: { orden: 'asc' } }, pagos: { orderBy: { id: 'asc' } } },
      }),
      datos.formaPagoCatalogo.findMany({
        where: { empresaId: filtro.empresaId },
        select: { formaRaw: true, forma: true },
      }),
    ]);
    const formas = new Map(catalogo.map((c) => [c.formaRaw, c.forma]));
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
      };
    });
    return { items, ...base };
  }
}
