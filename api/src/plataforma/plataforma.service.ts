import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { Prisma, RolUsuario } from '@prisma/client';

import { ARGON2_OPCIONES } from '../auth/argon2';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  SELECT_ADMIN,
  SELECT_PAGO,
  SELECT_PLAN,
  SELECT_SUSCRIPCION,
  type AdminGuardado,
  type DatosPlan,
  type PagoGuardado,
  type PlanGuardado,
  type SuscripcionGuardada,
} from '../scope/plataforma';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import type {
  AdminDto,
  AjustesDto,
  AltaClienteDto,
  BitacoraDto,
  BitacoraQueryDto,
  CambiarEstadoDto,
  ClienteDetalleDto,
  ClienteResumenDto,
  ClientesQueryDto,
  ColorAcento,
  CrearAdminDto,
  CrearPlanDto,
  CuentaClienteDto,
  CuentaConvertidaDto,
  EditarAdminDto,
  EditarClienteDto,
  EditarPlanDto,
  GuardarSuscripcionDto,
  MembresiaPropiaDto,
  MensualidadDto,
  MetricasDto,
  PagoDto,
  PagoRegistradoDto,
  PagosMesDto,
  PagosQueryDto,
  PlanDto,
  RegistrarPagoDto,
  SuscripcionDto,
  UltimoPagoDto,
} from './dto/plataforma.dto';
import {
  diaDeTexto,
  esDiaValido,
  estadoEfectivo,
  estadoPagoMes,
  fechaLimite,
  hoyPlataforma,
  mesDe,
  sumarDias,
  textoDia,
  type EstadoEfectivo,
} from './membresia';

/** Un agente "conectado" = se reportó en los últimos 10 min (el umbral de la pestaña Agentes). */
export const UMBRAL_AGENTE_CONECTADO_MS = 10 * 60 * 1000;

/** Quien hace el request: id del token y su scope (global; el guard ya lo exigió). */
export interface QuienPlataforma {
  actorId: string;
  scope: EmpresaScope;
}

function exigirGlobal(scope: EmpresaScope): void {
  if (scope.tipo !== 'global') {
    throw new Error('Panel de plataforma: exige scope global (el guard debió responder 404).');
  }
}

function emailDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Un día `AAAA-MM-DD` del body que además exista (2026-02-30 = 400). */
function diaDelBody(campo: string, texto: string): Date {
  if (!esDiaValido(texto)) throw new BadRequestException(`${campo} no es una fecha válida`);
  return diaDeTexto(texto);
}

/** Los campos de un PATCH que sí vinieron. Un PATCH sin ninguno es 400. */
function exigirCampos(dto: object): void {
  if (!Object.values(dto).some((v) => v !== undefined)) {
    throw new BadRequestException('No hay nada que cambiar');
  }
}

const SELECT_EMPRESA_CLIENTE = {
  id: true,
  nombre: true,
  activo: true,
  createdAt: true,
  contactoNombre: true,
  contactoTelefono: true,
  contactoEmail: true,
  rfc: true,
  notasPlataforma: true,
  suscripcion: { select: SELECT_SUSCRIPCION },
} as const satisfies Prisma.EmpresaSelect;
type EmpresaCliente = Prisma.EmpresaGetPayload<{ select: typeof SELECT_EMPRESA_CLIENTE }>;

/**
 * El panel de plataforma (membresías): lo que vendemos y a quién. SÓLO admin_global (lo exige
 * `SoloPlataformaGuard`, que responde 404 a cualquier otro rol). Las lecturas van por
 * `para(scope)` con scope global; las escrituras por `plataforma(scope)` (ver
 * `src/scope/plataforma.ts`), que deja su bitácora en la misma transacción.
 */
@Injectable()
export class PlataformaService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  #hoy(): Date {
    return hoyPlataforma(this.reloj.ahora());
  }

  #escritura({ actorId, scope }: QuienPlataforma) {
    return this.datos.plataforma(scope, actorId, this.#hoy());
  }

  #leer(scope: EmpresaScope): DatosScoped {
    exigirGlobal(scope);
    return this.datos.para(scope);
  }

  // --- Formas de salida ------------------------------------------------------------------------

  #plan(p: PlanGuardado) {
    return {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precioMensual: p.precioMensual.toFixed(2),
      periodicidad: p.periodicidad,
      limiteSucursales: p.limiteSucursales,
      activo: p.activo,
    };
  }

  #suscripcion(s: SuscripcionGuardada, hoy: Date): SuscripcionDto {
    return {
      id: s.id,
      plan: this.#plan(s.plan),
      estado: s.estado,
      estadoEfectivo: estadoEfectivo(s, hoy),
      inicio: textoDia(s.inicio),
      vencimiento: textoDia(s.vencimiento),
      fechaLimite: textoDia(fechaLimite(s)),
      diasGracia: s.diasGracia,
      diaCorte: s.diaCorte,
      notas: s.notas,
    };
  }

  #pago(p: PagoGuardado): PagoDto {
    return {
      id: p.id,
      empresaId: p.empresaId,
      monto: p.monto.toFixed(2),
      moneda: p.moneda,
      fechaPago: textoDia(p.fechaPago),
      metodo: p.metodo,
      referencia: p.referencia,
      periodoDesde: textoDia(p.periodoDesde),
      periodoHasta: textoDia(p.periodoHasta),
      notas: p.notas,
      registradoPor: `${p.registradoPor.nombre} <${p.registradoPor.email}>`,
      registradoAt: p.createdAt.toISOString(),
      anuladoAt: p.anuladoAt?.toISOString() ?? null,
      anuladoPor: p.anuladoPor ? `${p.anuladoPor.nombre} <${p.anuladoPor.email}>` : null,
      motivoAnulacion: p.motivoAnulacion,
    };
  }

  #admin(a: AdminGuardado): AdminDto {
    return {
      id: a.id,
      nombre: a.nombre,
      email: a.email,
      activo: a.activo,
      ultimoAccesoAt: a.ultimoAccesoAt?.toISOString() ?? null,
    };
  }

  // --- Planes ----------------------------------------------------------------------------------

  async planes(scope: EmpresaScope): Promise<PlanDto[]> {
    const datos = this.#leer(scope);
    const [planes, usos] = await Promise.all([
      datos.plan.findMany({
        select: SELECT_PLAN,
        orderBy: [{ precioMensual: 'asc' }, { nombre: 'asc' }],
      }),
      datos.suscripcion.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);
    const porPlan = new Map(usos.map((u) => [u.planId, u._count._all]));
    return planes.map((p) => ({ ...this.#plan(p), clientes: porPlan.get(p.id) ?? 0 }));
  }

  async crearPlan(quien: QuienPlataforma, dto: CrearPlanDto): Promise<PlanDto> {
    const datos: DatosPlan = {
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      precioMensual: dto.precioMensual,
      periodicidad: dto.periodicidad ?? 'mensual',
      limiteSucursales: dto.limiteSucursales ?? null,
      activo: dto.activo ?? true,
    };
    try {
      return { ...this.#plan(await this.#escritura(quien).crearPlan(datos)), clientes: 0 };
    } catch (error) {
      if (emailDuplicado(error)) throw new ConflictException('Ya hay un plan con ese nombre');
      throw error;
    }
  }

  async editarPlan(quien: QuienPlataforma, id: string, dto: EditarPlanDto): Promise<PlanDto> {
    exigirCampos(dto);
    let plan: PlanGuardado;
    try {
      plan = await this.#escritura(quien).editarPlan(id, dto);
    } catch (error) {
      if (emailDuplicado(error)) throw new ConflictException('Ya hay un plan con ese nombre');
      throw error;
    }
    const clientes = await this.#leer(quien.scope).suscripcion.count({ where: { planId: id } });
    return { ...this.#plan(plan), clientes };
  }

  borrarPlan(quien: QuienPlataforma, id: string): Promise<void> {
    return this.#escritura(quien).borrarPlan(id);
  }

  // --- Clientes --------------------------------------------------------------------------------

  /** Conteos por empresa para la lista y el detalle (todo en el WHERE, con scope global). */
  async #resumenes(datos: DatosScoped, empresas: EmpresaCliente[]): Promise<ClienteResumenDto[]> {
    const ids = empresas.map((e) => e.id);
    if (ids.length === 0) return [];
    const hoy = this.#hoy();
    const hace = new Date(this.reloj.ahora() - UMBRAL_AGENTE_CONECTADO_MS);
    const [sucursales, agentes, usuarios, pagos, ventas] = await Promise.all([
      datos.sucursal.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: ids }, activo: true },
        _count: { _all: true },
      }),
      datos.agenteContacto.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: ids },
          ultimoContactoAt: { gt: hace },
          sucursal: { activo: true },
        },
        _count: { _all: true },
      }),
      datos.usuario.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: ids }, activo: true },
        _count: { _all: true },
      }),
      datos.pagoSuscripcion.findMany({
        where: { empresaId: { in: ids }, anuladoAt: null },
        distinct: ['empresaId'],
        orderBy: [{ empresaId: 'asc' }, { fechaPago: 'desc' }, { createdAt: 'desc' }],
        select: { empresaId: true, fechaPago: true, monto: true, moneda: true },
      }),
      // Una consulta por empresa: usa el índice (empresa_id, cerrado_at) hacia atrás y lee UNA
      // fila; un GROUP BY sobre todos los cheques recorrería la tabla entera.
      Promise.all(
        ids.map((empresaId) =>
          datos.cheque.findFirst({
            where: { empresaId, cerradoAt: { not: null } },
            orderBy: { cerradoAt: 'desc' },
            select: { empresaId: true, cerradoAt: true },
          }),
        ),
      ),
    ]);
    const conteo = (filas: { empresaId: string | null; _count: { _all: number } }[]) =>
      new Map(filas.map((f) => [f.empresaId, f._count._all]));
    const nSucursales = conteo(sucursales);
    const nAgentes = conteo(agentes);
    const nUsuarios = conteo(usuarios);
    const ultimoPago = new Map<string, UltimoPagoDto>(
      pagos.map((p) => [
        p.empresaId,
        { fechaPago: textoDia(p.fechaPago), monto: p.monto.toFixed(2), moneda: p.moneda },
      ]),
    );
    const ultimaVenta = new Map(
      ventas.filter((v) => v !== null).map((v) => [v.empresaId, v.cerradoAt]),
    );
    return empresas.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      activo: e.activo,
      suscripcion: e.suscripcion ? this.#suscripcion(e.suscripcion, hoy) : null,
      ultimoPago: ultimoPago.get(e.id) ?? null,
      sucursales: nSucursales.get(e.id) ?? 0,
      agentesConectados: nAgentes.get(e.id) ?? 0,
      usuarios: nUsuarios.get(e.id) ?? 0,
      ultimaVentaRecibidaAt: ultimaVenta.get(e.id)?.toISOString() ?? null,
    }));
  }

  async clientes(scope: EmpresaScope, q: ClientesQueryDto): Promise<ClienteResumenDto[]> {
    const datos = this.#leer(scope);
    const empresas = await datos.empresa.findMany({
      where: q.q ? { nombre: { contains: q.q, mode: 'insensitive' } } : {},
      select: SELECT_EMPRESA_CLIENTE,
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const hoy = this.#hoy();
    // El estado efectivo se calcula al leer: el filtro va en memoria, sobre la lista ya acotada.
    const filtradas =
      q.estado === undefined
        ? empresas
        : empresas.filter((e) =>
            q.estado === 'sin_suscripcion'
              ? e.suscripcion === null
              : e.suscripcion !== null && estadoEfectivo(e.suscripcion, hoy) === q.estado,
          );
    return this.#resumenes(datos, filtradas);
  }

  async cliente(scope: EmpresaScope, empresaId: string): Promise<ClienteDetalleDto> {
    const datos = this.#leer(scope);
    const empresa = encontradoOr404(
      await datos.empresa.findFirst({ where: { id: empresaId }, select: SELECT_EMPRESA_CLIENTE }),
    );
    const [[resumen], sucursales, usuarios, pagos] = await Promise.all([
      this.#resumenes(datos, [empresa]),
      datos.sucursal.findMany({
        where: { empresaId },
        select: {
          id: true,
          nombre: true,
          activo: true,
          apiKeyHash: true,
          agenteContacto: { select: { ultimoContactoAt: true } },
          agenteEstado: { select: { versionAgente: true } },
        },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      datos.usuario.findMany({
        where: { empresaId },
        select: {
          id: true,
          nombre: true,
          email: true,
          rol: true,
          activo: true,
          ultimoAccesoAt: true,
        },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      datos.pagoSuscripcion.findMany({
        where: { empresaId },
        select: SELECT_PAGO,
        orderBy: [{ fechaPago: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    return {
      ...resumen,
      creadaAt: empresa.createdAt.toISOString(),
      contacto: {
        contactoNombre: empresa.contactoNombre,
        contactoTelefono: empresa.contactoTelefono,
        contactoEmail: empresa.contactoEmail,
        rfc: empresa.rfc,
        notasPlataforma: empresa.notasPlataforma,
      },
      // La API key nunca sale: sólo si existe.
      listaSucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        activo: s.activo,
        tieneApiKey: s.apiKeyHash !== null,
        ultimoContactoAt: s.agenteContacto?.ultimoContactoAt.toISOString() ?? null,
        versionAgente: s.agenteEstado?.versionAgente ?? null,
      })),
      listaUsuarios: usuarios.map((u) => ({
        ...u,
        ultimoAccesoAt: u.ultimoAccesoAt?.toISOString() ?? null,
      })),
      pagos: pagos.map((p) => this.#pago(p)),
    };
  }

  async altaCliente(quien: QuienPlataforma, dto: AltaClienteDto): Promise<ClienteDetalleDto> {
    const vencimiento =
      dto.vencimiento === undefined ? null : diaDelBody('vencimiento', dto.vencimiento);
    const passwordHash = await hash(dto.administrador.password, ARGON2_OPCIONES);
    let empresaId: string;
    try {
      ({ empresaId } = await this.#escritura(quien).altaCliente({
        nombre: dto.nombre,
        contactoNombre: dto.contactoNombre ?? null,
        contactoTelefono: dto.contactoTelefono ?? null,
        contactoEmail: dto.contactoEmail ?? null,
        rfc: dto.rfc ?? null,
        notasPlataforma: dto.notasPlataforma ?? null,
        planId: dto.planId,
        estado: dto.estado ?? 'activa',
        diaCorte: dto.diaCorte,
        diasGracia: dto.diasGracia ?? 5,
        vencimiento,
        notasSuscripcion: dto.notasSuscripcion ?? null,
        administrador: {
          nombre: dto.administrador.nombre,
          email: dto.administrador.email,
          passwordHash,
        },
      }));
    } catch (error) {
      if (emailDuplicado(error)) throw new ConflictException('Ese email ya está en uso');
      throw error;
    }
    return this.cliente(quien.scope, empresaId);
  }

  async editarCliente(
    quien: QuienPlataforma,
    empresaId: string,
    dto: EditarClienteDto,
  ): Promise<ClienteDetalleDto> {
    exigirCampos(dto);
    await this.#escritura(quien).editarCliente(empresaId, dto);
    return this.cliente(quien.scope, empresaId);
  }

  async guardarSuscripcion(
    quien: QuienPlataforma,
    empresaId: string,
    dto: GuardarSuscripcionDto,
  ): Promise<SuscripcionDto> {
    exigirCampos(dto);
    const s = await this.#escritura(quien).guardarSuscripcion(empresaId, {
      planId: dto.planId,
      vencimiento:
        dto.vencimiento === undefined ? undefined : diaDelBody('vencimiento', dto.vencimiento),
      diaCorte: dto.diaCorte,
      diasGracia: dto.diasGracia,
      notas: dto.notas,
    });
    return this.#suscripcion(s, this.#hoy());
  }

  async cambiarEstado(
    quien: QuienPlataforma,
    empresaId: string,
    dto: CambiarEstadoDto,
  ): Promise<SuscripcionDto> {
    const s = await this.#escritura(quien).cambiarEstado(empresaId, dto.estado, dto.motivo ?? null);
    return this.#suscripcion(s, this.#hoy());
  }

  // --- Pagos -----------------------------------------------------------------------------------

  async pagosDeCliente(scope: EmpresaScope, empresaId: string): Promise<PagoDto[]> {
    const datos = this.#leer(scope);
    encontradoOr404(
      await datos.empresa.findFirst({ where: { id: empresaId }, select: { id: true } }),
    );
    const pagos = await datos.pagoSuscripcion.findMany({
      where: { empresaId },
      select: SELECT_PAGO,
      orderBy: [{ fechaPago: 'desc' }, { createdAt: 'desc' }],
    });
    return pagos.map((p) => this.#pago(p));
  }

  async registrarPago(
    quien: QuienPlataforma,
    empresaId: string,
    dto: RegistrarPagoDto,
  ): Promise<PagoRegistradoDto> {
    if (new Prisma.Decimal(dto.monto).lte(0)) {
      throw new BadRequestException('El monto tiene que ser mayor que cero');
    }
    const fechaPago = diaDelBody('fechaPago', dto.fechaPago);
    const hoy = this.#hoy();
    if (fechaPago.getTime() > hoy.getTime()) {
      throw new BadRequestException('La fecha de pago no puede ser futura');
    }
    const { pago, suscripcion } = await this.#escritura(quien).registrarPago(empresaId, {
      monto: dto.monto,
      moneda: dto.moneda ?? 'MXN',
      fechaPago,
      metodo: dto.metodo,
      referencia: dto.referencia ?? null,
      notas: dto.notas ?? null,
      periodos: dto.periodos ?? 1,
    });
    return { pago: this.#pago(pago), suscripcion: this.#suscripcion(suscripcion, hoy) };
  }

  async anularPago(quien: QuienPlataforma, pagoId: string, motivo: string): Promise<PagoDto> {
    return this.#pago(await this.#escritura(quien).anularPago(pagoId, motivo));
  }

  /** La pantalla de Pagos: la mensualidad del mes en curso de cada cliente con suscripción. */
  async pagosDelMes(scope: EmpresaScope, q: PagosQueryDto): Promise<PagosMesDto> {
    const datos = this.#leer(scope);
    const hoy = this.#hoy();
    const { desde, hasta } = mesDe(hoy);
    const [suscripciones, cobrado] = await Promise.all([
      datos.suscripcion.findMany({
        where: q.q ? { empresa: { nombre: { contains: q.q, mode: 'insensitive' } } } : {},
        select: { ...SELECT_SUSCRIPCION, empresa: { select: { nombre: true, activo: true } } },
        orderBy: [{ empresa: { nombre: 'asc' } }, { id: 'asc' }],
      }),
      datos.pagoSuscripcion.aggregate({
        where: { anuladoAt: null, fechaPago: { gte: desde, lte: hasta } },
        _sum: { monto: true },
      }),
    ]);
    const ids = suscripciones.map((s) => s.empresaId);
    const ultimos = ids.length
      ? await datos.pagoSuscripcion.findMany({
          where: { empresaId: { in: ids }, anuladoAt: null },
          distinct: ['empresaId'],
          orderBy: [{ empresaId: 'asc' }, { fechaPago: 'desc' }, { createdAt: 'desc' }],
          select: { empresaId: true, fechaPago: true, monto: true, moneda: true },
        })
      : [];
    const ultimoPago = new Map(ultimos.map((p) => [p.empresaId, p]));
    const todas: MensualidadDto[] = suscripciones.map((s) => {
      const u = ultimoPago.get(s.empresaId);
      return {
        empresaId: s.empresaId,
        empresa: s.empresa.nombre,
        empresaActiva: s.empresa.activo,
        plan: s.plan.nombre,
        precioMensual: s.plan.precioMensual.toFixed(2),
        periodicidad: s.plan.periodicidad,
        diaCorte: s.diaCorte,
        vencimiento: textoDia(s.vencimiento),
        estadoEfectivo: estadoEfectivo(s, hoy),
        estadoPago: estadoPagoMes(s, hoy),
        ultimoPago: u
          ? { fechaPago: textoDia(u.fechaPago), monto: u.monto.toFixed(2), moneda: u.moneda }
          : null,
      };
    });
    const cuenta = (e: string) => todas.filter((m) => m.estadoPago === e).length;
    return {
      mes: textoDia(hoy).slice(0, 7),
      conteos: {
        todos: todas.length,
        pagados: cuenta('pagado'),
        pendientes: cuenta('pendiente'),
        vencidos: cuenta('vencido'),
      },
      cobradoMes: (cobrado._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
      mensualidades: q.estado ? todas.filter((m) => m.estadoPago === q.estado) : todas,
    };
  }

  // --- Métricas --------------------------------------------------------------------------------

  async metricas(scope: EmpresaScope): Promise<MetricasDto> {
    const datos = this.#leer(scope);
    const hoy = this.#hoy();
    const { desde, hasta } = mesDe(hoy);
    const [suscripciones, empresas, ingresos] = await Promise.all([
      datos.suscripcion.findMany({
        select: {
          estado: true,
          vencimiento: true,
          diasGracia: true,
          plan: { select: { precioMensual: true } },
        },
      }),
      datos.empresa.count(),
      datos.pagoSuscripcion.aggregate({
        where: { anuladoAt: null, fechaPago: { gte: desde, lte: hasta } },
        _sum: { monto: true },
      }),
    ]);
    const conteo: Record<EstadoEfectivo, number> = {
      prueba: 0,
      activa: 0,
      vencida: 0,
      suspendida: 0,
      cancelada: 0,
    };
    let mrr = new Prisma.Decimal(0);
    let vencen = 0;
    const en7 = sumarDias(hoy, 7);
    for (const s of suscripciones) {
      const estado = estadoEfectivo(s, hoy);
      conteo[estado] += 1;
      // MRR: lo que cobramos al mes a quien sigue siendo cliente de pago (activa o vencida: la
      // vencida todavía se cobra). Prueba, suspendida y cancelada no suman.
      if (estado === 'activa' || estado === 'vencida') mrr = mrr.plus(s.plan.precioMensual);
      if (
        (estado === 'activa' || estado === 'prueba') &&
        s.vencimiento.getTime() >= hoy.getTime() &&
        s.vencimiento.getTime() <= en7.getTime()
      ) {
        vencen += 1;
      }
    }
    return {
      mrr: mrr.toFixed(2),
      activos: conteo.activa,
      prueba: conteo.prueba,
      vencidos: conteo.vencida,
      suspendidos: conteo.suspendida,
      cancelados: conteo.cancelada,
      sinSuscripcion: empresas - suscripciones.length,
      ingresosMes: (ingresos._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
      vencenProximos7Dias: vencen,
      hoy: textoDia(hoy),
    };
  }

  // --- Administradores internos ----------------------------------------------------------------

  async administradores(scope: EmpresaScope): Promise<AdminDto[]> {
    const admins = await this.#leer(scope).usuario.findMany({
      where: { rol: RolUsuario.admin_global },
      select: SELECT_ADMIN,
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }, { id: 'asc' }],
    });
    return admins.map((a) => this.#admin(a));
  }

  async crearAdmin(quien: QuienPlataforma, dto: CrearAdminDto): Promise<AdminDto> {
    const passwordHash = await hash(dto.password, ARGON2_OPCIONES);
    try {
      return this.#admin(
        await this.#escritura(quien).crearAdmin({
          nombre: dto.nombre,
          email: dto.email,
          passwordHash,
        }),
      );
    } catch (error) {
      if (emailDuplicado(error)) throw new ConflictException('Ese email ya está en uso');
      throw error;
    }
  }

  async editarAdmin(quien: QuienPlataforma, id: string, dto: EditarAdminDto): Promise<AdminDto> {
    exigirCampos(dto);
    try {
      return this.#admin(await this.#escritura(quien).editarAdmin(id, dto));
    } catch (error) {
      if (emailDuplicado(error)) throw new ConflictException('Ese email ya está en uso');
      throw error;
    }
  }

  /** Busca por correo una cuenta de CLIENTE (admin_empresa o visor) para convertirla. */
  async buscarCuenta(scope: EmpresaScope, email: string): Promise<CuentaClienteDto> {
    const u = encontradoOr404(
      await this.#leer(scope).usuario.findFirst({
        where: { email, rol: { in: [RolUsuario.admin_empresa, RolUsuario.visor] } },
        select: {
          id: true,
          nombre: true,
          email: true,
          rol: true,
          activo: true,
          empresaId: true,
          empresa: { select: { nombre: true } },
        },
      }),
    );
    return {
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      empresaId: u.empresaId as string,
      empresa: u.empresa?.nombre ?? '',
    };
  }

  async convertirCuenta(quien: QuienPlataforma, usuarioId: string): Promise<CuentaConvertidaDto> {
    const r = await this.#escritura(quien).convertirCuenta(usuarioId);
    return {
      admin: this.#admin(r.admin),
      empresaId: r.empresaId,
      empresaSinAdmin: r.empresaSinAdmin,
    };
  }

  // --- Bitácora --------------------------------------------------------------------------------

  async bitacora(scope: EmpresaScope, q: BitacoraQueryDto): Promise<BitacoraDto> {
    const datos = this.#leer(scope);
    const pagina = q.pagina ?? 1;
    const porPagina = q.porPagina ?? 25;
    const where = q.empresaId ? { empresaId: q.empresaId } : {};
    const [total, filas] = await Promise.all([
      datos.bitacoraPlataforma.count({ where }),
      datos.bitacoraPlataforma.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);
    const ids = [...new Set(filas.map((f) => f.empresaId).filter((id): id is string => !!id))];
    const empresas = ids.length
      ? await datos.empresa.findMany({
          where: { id: { in: ids } },
          select: { id: true, nombre: true },
        })
      : [];
    const nombre = new Map(empresas.map((e) => [e.id, e.nombre]));
    return {
      total,
      pagina,
      porPagina,
      entradas: filas.map((f) => ({
        id: f.id,
        createdAt: f.createdAt.toISOString(),
        actorId: f.actorId,
        actorEmail: f.actorEmail,
        accion: f.accion,
        empresaId: f.empresaId,
        empresa: f.empresaId ? (nombre.get(f.empresaId) ?? null) : null,
        recurso: f.recurso,
        recursoId: f.recursoId,
        antes: f.antes,
        despues: f.despues,
      })),
    };
  }

  // --- Ajustes ---------------------------------------------------------------------------------

  async ajustes(scope: EmpresaScope): Promise<AjustesDto> {
    exigirGlobal(scope);
    return { colorAcento: await this.colorAcentoPublico() };
  }

  async guardarAjustes(
    quien: QuienPlataforma,
    colorAcento: ColorAcento | null,
  ): Promise<AjustesDto> {
    const r = await this.#escritura(quien).guardarAjustes(colorAcento);
    return { colorAcento: r.colorAcento as ColorAcento | null };
  }

  /** El color global (público: lo lee `GET /sistema` antes del login). */
  async colorAcentoPublico(): Promise<ColorAcento | null> {
    return (await this.datos.aparienciaPlataforma().colorAcento()) as ColorAcento | null;
  }

  // --- La membresía propia (cualquier usuario de una empresa) ----------------------------------

  async membresiaPropia(scope: EmpresaScope): Promise<MembresiaPropiaDto | null> {
    // admin_global no es de ninguna empresa: no tiene membresía.
    if (scope.tipo === 'global') return null;
    const s = await this.datos.para(scope).suscripcion.findFirst({
      where: { empresaId: scope.empresaId },
      select: {
        estado: true,
        vencimiento: true,
        diasGracia: true,
        plan: { select: { nombre: true } },
      },
    });
    if (!s) return null;
    const hoy = this.#hoy();
    return {
      estado: estadoEfectivo(s, hoy),
      vencimiento: textoDia(s.vencimiento),
      fechaLimite: textoDia(fechaLimite(s)),
      plan: s.plan.nombre,
    };
  }
}
