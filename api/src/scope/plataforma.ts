import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EstadoSuscripcion, Prisma, RolUsuario, type MetodoPago } from '@prisma/client';

import {
  bloqueaAcceso,
  mensajeLimiteSucursales,
  mesesPorPeriodo,
  siguienteCorte,
  sumarMeses,
  textoDia,
} from '../plataforma/membresia';
import type { EmpresaScope } from './empresa-scope';
import {
  EscrituraAdmin,
  SELECT_SUCURSAL,
  SELECT_USUARIO,
  type UsuarioCreado,
} from './escritura-admin';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * El panel de plataforma (membresías), parte del helper obligatorio de scope. Es la ÚNICA pieza
 * que ESCRIBE planes, suscripciones, pagos, la bitácora de plataforma, los ajustes globales y los
 * administradores internos (admin_global). Toda escritura:
 *
 * - exige scope `global` y LANZA con otro (error de programación: la ruta ya respondió 404);
 * - corre en UNA transacción con `statement_timeout` corto, junto con su línea de bitácora (si la
 *   bitácora no se escribe, el cambio tampoco);
 * - relee al actor DENTRO de la transacción: tiene que seguir siendo un admin_global activo (un
 *   access token de alguien recién desactivado no escribe).
 *
 * Las LECTURAS del panel van por `para(scope)` (scope global = todas las empresas), como cualquier
 * otra lectura. `CupoSucursales` (abajo) es la otra escritura: la usa también el admin_empresa.
 */

const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 15_000;
const ESPERA_CONEXION_MS = 5000;

type Tx = Prisma.TransactionClient;

export interface ClientePlataforma {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function enTransaccion<T>(cliente: ClientePlataforma, fn: (tx: Tx) => Promise<T>): Promise<T> {
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
    throw new Error(`${que}: el panel de plataforma exige scope global.`);
  }
}

/** Las acciones que deja la bitácora. Texto estable: lo filtra y lo pinta la web. */
export type AccionBitacora =
  | 'cliente.crear'
  | 'cliente.editar'
  | 'cliente.suspender'
  | 'cliente.reactivar'
  | 'cliente.cancelar'
  | 'suscripcion.crear'
  | 'suscripcion.cambiar_plan'
  | 'suscripcion.editar'
  | 'pago.registrar'
  | 'pago.anular'
  | 'plan.crear'
  | 'plan.editar'
  | 'plan.borrar'
  | 'admin.crear'
  | 'admin.editar'
  | 'admin.desactivar'
  | 'admin.reactivar'
  | 'admin.convertir_cuenta'
  | 'ajustes.editar'
  | 'sucursal.forzar_limite';

interface Actor {
  id: string;
  email: string;
}

interface Entrada {
  accion: AccionBitacora;
  empresaId?: string | null;
  recurso?: string;
  recursoId?: string;
  antes?: Prisma.InputJsonValue;
  despues?: Prisma.InputJsonValue;
}

async function escribirBitacora(tx: Tx, actor: Actor, e: Entrada): Promise<void> {
  await tx.bitacoraPlataforma.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      accion: e.accion,
      empresaId: e.empresaId ?? null,
      recurso: e.recurso ?? null,
      recursoId: e.recursoId ?? null,
      antes: e.antes ?? Prisma.JsonNull,
      despues: e.despues ?? Prisma.JsonNull,
    },
  });
}

/** El actor, releído en la transacción: admin_global activo, o 401. */
async function actorVigente(tx: Tx, actorId: string): Promise<Actor> {
  const actor = await tx.usuario.findFirst({
    where: { id: actorId, rol: RolUsuario.admin_global, activo: true, empresaId: null },
    select: { id: true, email: true },
  });
  if (!actor) throw new UnauthorizedException('No autenticado');
  return actor;
}

// --- Formas de datos ---------------------------------------------------------------------------

export const SELECT_PLAN = {
  id: true,
  nombre: true,
  descripcion: true,
  precioMensual: true,
  periodicidad: true,
  limiteSucursales: true,
  activo: true,
} as const satisfies Prisma.PlanSelect;
export type PlanGuardado = Prisma.PlanGetPayload<{ select: typeof SELECT_PLAN }>;

export const SELECT_SUSCRIPCION = {
  id: true,
  empresaId: true,
  estado: true,
  inicio: true,
  vencimiento: true,
  diasGracia: true,
  diaCorte: true,
  notas: true,
  plan: { select: SELECT_PLAN },
} as const satisfies Prisma.SuscripcionSelect;
export type SuscripcionGuardada = Prisma.SuscripcionGetPayload<{
  select: typeof SELECT_SUSCRIPCION;
}>;

export const SELECT_PAGO = {
  id: true,
  empresaId: true,
  suscripcionId: true,
  monto: true,
  moneda: true,
  fechaPago: true,
  metodo: true,
  referencia: true,
  periodoDesde: true,
  periodoHasta: true,
  notas: true,
  createdAt: true,
  anuladoAt: true,
  motivoAnulacion: true,
  registradoPor: { select: { id: true, nombre: true, email: true } },
  anuladoPor: { select: { id: true, nombre: true, email: true } },
} as const satisfies Prisma.PagoSuscripcionSelect;
export type PagoGuardado = Prisma.PagoSuscripcionGetPayload<{ select: typeof SELECT_PAGO }>;

export const SELECT_ADMIN = { ...SELECT_USUARIO, ultimoAccesoAt: true } as const;
export type AdminGuardado = Prisma.UsuarioGetPayload<{ select: typeof SELECT_ADMIN }>;

export interface DatosPlan {
  nombre: string;
  descripcion: string | null;
  /** Texto decimal ya validado (`"499.00"`). */
  precioMensual: string;
  periodicidad: Prisma.PlanCreateInput['periodicidad'];
  limiteSucursales: number | null;
  activo: boolean;
}

export interface DatosContacto {
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  contactoEmail?: string | null;
  rfc?: string | null;
  notasPlataforma?: string | null;
}

export interface DatosAltaCliente extends DatosContacto {
  nombre: string;
  planId: string;
  estado: 'prueba' | 'activa';
  diaCorte: number;
  diasGracia: number;
  /** Si no viene: el siguiente día de corte después de hoy. */
  vencimiento: Date | null;
  notasSuscripcion: string | null;
  administrador: { nombre: string; email: string; passwordHash: string };
}

export interface CambiosSuscripcion {
  planId?: string;
  vencimiento?: Date;
  diaCorte?: number;
  diasGracia?: number;
  notas?: string | null;
}

export interface DatosPago {
  /** Texto decimal ya validado y > 0. */
  monto: string;
  moneda: string;
  fechaPago: Date;
  metodo: MetodoPago;
  referencia: string | null;
  notas: string | null;
  /** Cuántos periodos del plan cubre (1 por omisión). */
  periodos: number;
}

/** Lo que la bitácora guarda de un plan: texto plano, sin Decimal. */
function planJson(p: PlanGuardado): Prisma.InputJsonObject {
  return {
    nombre: p.nombre,
    descripcion: p.descripcion,
    precioMensual: p.precioMensual.toFixed(2),
    periodicidad: p.periodicidad,
    limiteSucursales: p.limiteSucursales,
    activo: p.activo,
  };
}

function suscripcionJson(s: SuscripcionGuardada): Prisma.InputJsonObject {
  return {
    plan: s.plan.nombre,
    planId: s.plan.id,
    estado: s.estado,
    inicio: textoDia(s.inicio),
    vencimiento: textoDia(s.vencimiento),
    diasGracia: s.diasGracia,
    diaCorte: s.diaCorte,
    notas: s.notas,
  };
}

function pagoJson(p: PagoGuardado): Prisma.InputJsonObject {
  return {
    monto: p.monto.toFixed(2),
    moneda: p.moneda,
    fechaPago: textoDia(p.fechaPago),
    metodo: p.metodo,
    referencia: p.referencia,
    periodoDesde: textoDia(p.periodoDesde),
    periodoHasta: textoDia(p.periodoHasta),
    anulado: p.anuladoAt !== null,
    motivoAnulacion: p.motivoAnulacion,
  };
}

function adminJson(u: { nombre: string; email: string; activo: boolean; rol: RolUsuario }) {
  return { nombre: u.nombre, email: u.email, activo: u.activo, rol: u.rol };
}

/** Candado de la suscripción de una empresa (serializa pagos, anulaciones y altas de sucursal). */
async function bloquearSuscripcion(tx: Tx, empresaId: string): Promise<SuscripcionGuardada | null> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM suscripciones WHERE empresa_id = ${empresaId}::uuid FOR UPDATE`;
  if (filas.length === 0) return null;
  return tx.suscripcion.findFirst({ where: { id: filas[0].id }, select: SELECT_SUSCRIPCION });
}

/** La empresa, si existe. Scope global: cualquier empresa; con otro, esta clase ni se construye. */
async function empresaExistente(tx: Tx, empresaId: string) {
  return encontradoOr404(
    await tx.empresa.findFirst({
      where: { id: empresaId },
      select: {
        id: true,
        nombre: true,
        contactoNombre: true,
        contactoTelefono: true,
        contactoEmail: true,
        rfc: true,
        notasPlataforma: true,
      },
    }),
  );
}

async function planActivo(tx: Tx, planId: string): Promise<PlanGuardado> {
  const plan = await tx.plan.findFirst({ where: { id: planId }, select: SELECT_PLAN });
  if (!plan || !plan.activo) {
    throw new BadRequestException('El plan no existe o está inactivo');
  }
  return plan;
}

/** Candado de los administradores internos: "siempre queda al menos uno activo" sin carreras. */
async function bloquearAdmins(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('plataforma.administradores'))`;
}

export class EscrituraPlataforma {
  readonly #cliente: ClientePlataforma;
  readonly #scope: EmpresaScope;
  readonly #actorId: string;
  readonly #hoy: Date;

  /**
   * `hoy`: el día de hoy en la zona de la plataforma (`hoyPlataforma`), del reloj inyectable del
   * servicio. `actorId`: el usuario del access token.
   */
  constructor(cliente: ClientePlataforma, scope: EmpresaScope, actorId: string, hoy: Date) {
    exigirGlobal(scope, 'escritura de plataforma');
    if (typeof actorId !== 'string' || actorId.length === 0) {
      throw new Error('Escritura de plataforma: actor vacío.');
    }
    this.#cliente = cliente;
    this.#scope = scope;
    this.#actorId = actorId;
    this.#hoy = hoy;
  }

  #correr<T>(fn: (tx: Tx, actor: Actor) => Promise<T>): Promise<T> {
    return enTransaccion(this.#cliente, async (tx) =>
      fn(tx, await actorVigente(tx, this.#actorId)),
    );
  }

  // --- Planes ----------------------------------------------------------------------------------

  crearPlan(datos: DatosPlan): Promise<PlanGuardado> {
    return this.#correr(async (tx, actor) => {
      const plan = await tx.plan.create({ data: datos, select: SELECT_PLAN });
      await escribirBitacora(tx, actor, {
        accion: 'plan.crear',
        recurso: 'plan',
        recursoId: plan.id,
        despues: planJson(plan),
      });
      return plan;
    });
  }

  editarPlan(id: string, cambios: Partial<DatosPlan>): Promise<PlanGuardado> {
    return this.#correr(async (tx, actor) => {
      const antes = encontradoOr404(
        await tx.plan.findFirst({ where: { id }, select: SELECT_PLAN }),
      );
      const plan = await tx.plan.update({ where: { id }, data: cambios, select: SELECT_PLAN });
      await escribirBitacora(tx, actor, {
        accion: 'plan.editar',
        recurso: 'plan',
        recursoId: id,
        antes: planJson(antes),
        despues: planJson(plan),
      });
      return plan;
    });
  }

  /** Borra un plan que NADIE usa. Con suscripciones: 409 (se desactiva, no se borra). */
  borrarPlan(id: string): Promise<void> {
    return this.#correr(async (tx, actor) => {
      const plan = encontradoOr404(await tx.plan.findFirst({ where: { id }, select: SELECT_PLAN }));
      const enUso = await tx.suscripcion.count({ where: { planId: id } });
      if (enUso > 0) {
        throw new ConflictException(
          `El plan lo usan ${enUso} cliente(s): desactívalo en vez de borrarlo`,
        );
      }
      await tx.plan.delete({ where: { id } });
      await escribirBitacora(tx, actor, {
        accion: 'plan.borrar',
        recurso: 'plan',
        recursoId: id,
        antes: planJson(plan),
      });
    });
  }

  // --- Clientes y suscripciones ----------------------------------------------------------------

  /**
   * Alta de cliente: empresa (con contacto) + suscripción + su primer admin_empresa, en UNA
   * transacción. La empresa y el usuario se crean con `EscrituraAdmin` (las mismas reglas que la
   * administración y el alta guiada). Un email repetido revierte todo (P2002 → 409 en el servicio).
   */
  altaCliente(datos: DatosAltaCliente): Promise<{
    empresaId: string;
    suscripcion: SuscripcionGuardada;
    administrador: UsuarioCreado;
  }> {
    return this.#correr(async (tx, actor) => {
      const plan = await planActivo(tx, datos.planId);
      const admin = new EscrituraAdmin(tx, this.#scope);
      const empresa = await admin.crearEmpresa(datos.nombre);
      await tx.empresa.update({
        where: { id: empresa.id },
        data: {
          contactoNombre: datos.contactoNombre ?? null,
          contactoTelefono: datos.contactoTelefono ?? null,
          contactoEmail: datos.contactoEmail ?? null,
          rfc: datos.rfc ?? null,
          notasPlataforma: datos.notasPlataforma ?? null,
        },
      });
      const suscripcion = await tx.suscripcion.create({
        data: {
          empresaId: empresa.id,
          planId: plan.id,
          estado: datos.estado,
          inicio: this.#hoy,
          vencimiento: datos.vencimiento ?? siguienteCorte(this.#hoy, datos.diaCorte),
          diaCorte: datos.diaCorte,
          diasGracia: datos.diasGracia,
          notas: datos.notasSuscripcion,
        },
        select: SELECT_SUSCRIPCION,
      });
      const administrador = await admin.crearUsuario(empresa.id, {
        email: datos.administrador.email,
        nombre: datos.administrador.nombre,
        rol: RolUsuario.admin_empresa,
        passwordHash: datos.administrador.passwordHash,
      });
      await escribirBitacora(tx, actor, {
        accion: 'cliente.crear',
        empresaId: empresa.id,
        recurso: 'empresa',
        recursoId: empresa.id,
        despues: {
          nombre: empresa.nombre,
          suscripcion: suscripcionJson(suscripcion),
          administrador: { id: administrador.id, email: administrador.email },
        },
      });
      return { empresaId: empresa.id, suscripcion, administrador };
    });
  }

  editarCliente(empresaId: string, cambios: DatosContacto & { nombre?: string }): Promise<void> {
    return this.#correr(async (tx, actor) => {
      const antes = await empresaExistente(tx, empresaId);
      const despues = await tx.empresa.update({
        where: { id: empresaId },
        data: cambios,
        select: {
          nombre: true,
          contactoNombre: true,
          contactoTelefono: true,
          contactoEmail: true,
          rfc: true,
          notasPlataforma: true,
        },
      });
      const { id: _id, ...antesSinId } = antes;
      void _id;
      await escribirBitacora(tx, actor, {
        accion: 'cliente.editar',
        empresaId,
        recurso: 'empresa',
        recursoId: empresaId,
        antes: antesSinId,
        despues,
      });
    });
  }

  /**
   * Cambia plan, vencimiento, día de corte, gracia o notas. Si la empresa no tiene suscripción
   * (nació fuera del panel de plataforma), la CREA: `activa`, desde hoy, con `planId` obligatorio.
   */
  guardarSuscripcion(empresaId: string, cambios: CambiosSuscripcion): Promise<SuscripcionGuardada> {
    return this.#correr(async (tx, actor) => {
      await empresaExistente(tx, empresaId);
      const actual = await bloquearSuscripcion(tx, empresaId);
      if (cambios.planId !== undefined && cambios.planId !== actual?.plan.id) {
        await planActivo(tx, cambios.planId);
      }
      if (!actual) {
        if (cambios.planId === undefined) {
          throw new BadRequestException('La empresa no tiene suscripción: indica el plan');
        }
        const diaCorte = cambios.diaCorte ?? Math.min(this.#hoy.getUTCDate(), 28);
        const creada = await tx.suscripcion.create({
          data: {
            empresaId,
            planId: cambios.planId,
            estado: EstadoSuscripcion.activa,
            inicio: this.#hoy,
            vencimiento: cambios.vencimiento ?? siguienteCorte(this.#hoy, diaCorte),
            diaCorte,
            diasGracia: cambios.diasGracia ?? 5,
            notas: cambios.notas ?? null,
          },
          select: SELECT_SUSCRIPCION,
        });
        await escribirBitacora(tx, actor, {
          accion: 'suscripcion.crear',
          empresaId,
          recurso: 'suscripcion',
          recursoId: creada.id,
          despues: suscripcionJson(creada),
        });
        return creada;
      }
      const nueva = await tx.suscripcion.update({
        where: { id: actual.id },
        data: {
          planId: cambios.planId,
          vencimiento: cambios.vencimiento,
          diaCorte: cambios.diaCorte,
          diasGracia: cambios.diasGracia,
          notas: cambios.notas,
        },
        select: SELECT_SUSCRIPCION,
      });
      await escribirBitacora(tx, actor, {
        accion:
          nueva.plan.id !== actual.plan.id ? 'suscripcion.cambiar_plan' : 'suscripcion.editar',
        empresaId,
        recurso: 'suscripcion',
        recursoId: actual.id,
        antes: suscripcionJson(actual),
        despues: suscripcionJson(nueva),
      });
      return nueva;
    });
  }

  /**
   * Cambia el estado GUARDADO a mano. `suspendida` y `cancelada` cortan a los usuarios de la
   * empresa: no entran ni refrescan (lo mira `AuthService`), y además se incrementa su
   * `versionSesion`, así que sus refresh tokens ya emitidos dejan de servir en ese instante. Su
   * access token vigente vive hasta que vence (15 min), como con cualquier baja.
   */
  cambiarEstado(
    empresaId: string,
    estado: EstadoSuscripcion,
    motivo: string | null,
  ): Promise<SuscripcionGuardada> {
    return this.#correr(async (tx, actor) => {
      await empresaExistente(tx, empresaId);
      const actual = await bloquearSuscripcion(tx, empresaId);
      if (!actual) {
        throw new ConflictException('La empresa no tiene suscripción: asígnale un plan primero');
      }
      const nueva = await tx.suscripcion.update({
        where: { id: actual.id },
        data: { estado },
        select: SELECT_SUSCRIPCION,
      });
      const corta =
        estado === EstadoSuscripcion.suspendida || estado === EstadoSuscripcion.cancelada;
      if (corta) {
        await tx.usuario.updateMany({
          where: { empresaId },
          data: { versionSesion: { increment: 1 } },
        });
      }
      await escribirBitacora(tx, actor, {
        accion:
          estado === EstadoSuscripcion.suspendida
            ? 'cliente.suspender'
            : estado === EstadoSuscripcion.cancelada
              ? 'cliente.cancelar'
              : 'cliente.reactivar',
        empresaId,
        recurso: 'suscripcion',
        recursoId: actual.id,
        antes: { estado: actual.estado },
        despues: { estado, motivo },
      });
      return nueva;
    });
  }

  /**
   * Registra un pago bajo el candado de la suscripción. Cubre `periodos` periodos del plan DESDE
   * el vencimiento actual (no desde hoy: un cliente atrasado paga los meses que debe) y corre el
   * vencimiento hasta el final de lo cubierto. Si estaba en `prueba` o `suspendida`, queda
   * `activa`. Una suscripción `cancelada` no recibe pagos (409): se reactiva primero.
   */
  registrarPago(
    empresaId: string,
    datos: DatosPago,
  ): Promise<{ pago: PagoGuardado; suscripcion: SuscripcionGuardada }> {
    return this.#correr(async (tx, actor) => {
      await empresaExistente(tx, empresaId);
      const actual = await bloquearSuscripcion(tx, empresaId);
      if (!actual) {
        throw new ConflictException('La empresa no tiene suscripción: asígnale un plan primero');
      }
      if (actual.estado === EstadoSuscripcion.cancelada) {
        throw new ConflictException(
          'La suscripción está cancelada: reactívala antes de registrar un pago',
        );
      }
      const desde = actual.vencimiento;
      const hasta = sumarMeses(desde, mesesPorPeriodo(actual.plan.periodicidad) * datos.periodos);
      const pago = await tx.pagoSuscripcion.create({
        data: {
          empresaId,
          suscripcionId: actual.id,
          monto: datos.monto,
          moneda: datos.moneda,
          fechaPago: datos.fechaPago,
          metodo: datos.metodo,
          referencia: datos.referencia,
          notas: datos.notas,
          periodoDesde: desde,
          periodoHasta: hasta,
          registradoPorId: actor.id,
          estadoAnterior: actual.estado,
        },
        select: SELECT_PAGO,
      });
      const reactiva =
        actual.estado === EstadoSuscripcion.suspendida ||
        actual.estado === EstadoSuscripcion.prueba;
      const suscripcion = await tx.suscripcion.update({
        where: { id: actual.id },
        data: {
          vencimiento: hasta,
          ...(reactiva ? { estado: EstadoSuscripcion.activa } : {}),
        },
        select: SELECT_SUSCRIPCION,
      });
      await escribirBitacora(tx, actor, {
        accion: 'pago.registrar',
        empresaId,
        recurso: 'pago',
        recursoId: pago.id,
        antes: { vencimiento: textoDia(actual.vencimiento), estado: actual.estado },
        despues: {
          ...pagoJson(pago),
          vencimiento: textoDia(suscripcion.vencimiento),
          estado: suscripcion.estado,
        },
      });
      return { pago, suscripcion };
    });
  }

  /**
   * Anula un pago (nunca se borra). Sólo el MÁS RECIENTE no anulado de la suscripción (por
   * `created_at`): si hay uno posterior vigente, 409 (se anula primero ése). Deshace lo que hizo
   * el pago: el vencimiento vuelve al inicio de lo que cubría y, si el pago había reactivado la
   * suscripción (venía de `prueba` o `suspendida`) y sigue `activa`, regresa a ese estado (y el
   * MRR lo refleja). Si después alguien cambió el estado a mano, ése se respeta.
   */
  anularPago(pagoId: string, motivo: string): Promise<PagoGuardado> {
    return this.#correr(async (tx, actor) => {
      const pago = encontradoOr404(
        await tx.pagoSuscripcion.findFirst({
          where: { id: pagoId },
          select: { ...SELECT_PAGO, estadoAnterior: true },
        }),
      );
      const actual = await bloquearSuscripcion(tx, pago.empresaId);
      if (!actual || actual.id !== pago.suscripcionId) {
        throw new ConflictException('El pago es de una suscripción anterior: no se puede anular');
      }
      if (pago.anuladoAt !== null) {
        throw new ConflictException('El pago ya está anulado');
      }
      const ultimo = await tx.pagoSuscripcion.findFirst({
        where: { suscripcionId: actual.id, anuladoAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (ultimo?.id !== pagoId) {
        throw new ConflictException(
          'Hay un pago posterior sin anular: anula primero el más reciente',
        );
      }
      const anulado = await tx.pagoSuscripcion.update({
        where: { id: pagoId },
        data: { anuladoAt: new Date(), anuladoPorId: actor.id, motivoAnulacion: motivo },
        select: SELECT_PAGO,
      });
      const regresaEstado =
        actual.estado === EstadoSuscripcion.activa &&
        pago.estadoAnterior !== EstadoSuscripcion.activa &&
        pago.estadoAnterior !== EstadoSuscripcion.cancelada;
      const despues = await tx.suscripcion.update({
        where: { id: actual.id },
        data: {
          vencimiento: pago.periodoDesde,
          ...(regresaEstado ? { estado: pago.estadoAnterior } : {}),
        },
        select: { estado: true },
      });
      await escribirBitacora(tx, actor, {
        accion: 'pago.anular',
        empresaId: pago.empresaId,
        recurso: 'pago',
        recursoId: pagoId,
        antes: {
          ...pagoJson(pago),
          vencimiento: textoDia(actual.vencimiento),
          estado: actual.estado,
        },
        despues: {
          ...pagoJson(anulado),
          vencimiento: textoDia(pago.periodoDesde),
          estado: despues.estado,
        },
      });
      // Si la anulación regresa la suscripción a un estado que deja fuera a sus usuarios
      // (`suspendida`), se cortan sus sesiones igual que en la suspensión manual, y queda
      // constancia del cambio de estado aparte de la anulación.
      if (regresaEstado && bloqueaAcceso(despues.estado)) {
        await tx.usuario.updateMany({
          where: { empresaId: pago.empresaId },
          data: { versionSesion: { increment: 1 } },
        });
        await escribirBitacora(tx, actor, {
          accion: 'cliente.suspender',
          empresaId: pago.empresaId,
          recurso: 'suscripcion',
          recursoId: actual.id,
          antes: { estado: actual.estado },
          despues: { estado: despues.estado, motivo: `Anulación del pago ${pagoId}: ${motivo}` },
        });
      }
      return anulado;
    });
  }

  // --- Administradores internos ----------------------------------------------------------------

  crearAdmin(datos: {
    nombre: string;
    email: string;
    passwordHash: string;
  }): Promise<AdminGuardado> {
    return this.#correr(async (tx, actor) => {
      const creado = await new EscrituraAdmin(tx, this.#scope).crearUsuario(null, {
        ...datos,
        rol: RolUsuario.admin_global,
      });
      const admin = encontradoOr404(
        await tx.usuario.findFirst({ where: { id: creado.id }, select: SELECT_ADMIN }),
      );
      await escribirBitacora(tx, actor, {
        accion: 'admin.crear',
        recurso: 'usuario',
        recursoId: admin.id,
        despues: adminJson(admin),
      });
      return admin;
    });
  }

  /**
   * Edita nombre/correo de un admin interno, o lo desactiva / reactiva. NUNCA su contraseña (esa
   * sólo la cambia él mismo en `/cuenta/password`) y nunca se borra.
   *
   * "Siempre queda al menos un admin activo" lo SOSTIENEN tres cosas juntas, no el conteo de
   * abajo: (1) el actor se relee activo DESPUÉS de tomar el candado de administradores, (2)
   * nadie se desactiva a sí mismo (400), y (3) `/usuarios` ya no da de baja ni crea admins
   * (sólo esta pieza los toca). Con eso, quien desactiva a otro sigue activo él mismo. Dos que
   * se desactivan mutuamente a la vez se serializan en el candado y el segundo ya no es actor
   * vigente (401): test e2e "dos admins que se desactivan uno al otro A LA VEZ".
   */
  editarAdmin(
    id: string,
    cambios: { nombre?: string; email?: string; activo?: boolean },
  ): Promise<AdminGuardado> {
    return this.#correr(async (tx, actor) => {
      await bloquearAdmins(tx);
      // Otra vez, YA con el candado: si otro admin lo desactivó mientras esperaba, no sigue.
      await actorVigente(tx, actor.id);
      const antes = await tx.usuario.findFirst({
        where: { id, rol: RolUsuario.admin_global },
        select: SELECT_ADMIN,
      });
      if (!antes) throw new NotFoundException('Recurso no encontrado');
      if (cambios.activo === false && id === actor.id) {
        throw new BadRequestException('No puedes desactivarte a ti mismo');
      }
      // Defensa en profundidad: por (1)-(3) de arriba esto no se alcanza (el actor activo es otro
      // admin distinto del destino). Se deja por si alguna escritura futura se salta esta pieza.
      if (cambios.activo === false && antes.activo) {
        const otros = await tx.usuario.count({
          where: { rol: RolUsuario.admin_global, activo: true, id: { not: id } },
        });
        if (otros === 0) {
          throw new ConflictException('Siempre debe quedar al menos un administrador activo');
        }
      }
      const desactiva = cambios.activo === false && antes.activo;
      const admin = await tx.usuario.update({
        where: { id },
        data: {
          nombre: cambios.nombre,
          email: cambios.email,
          activo: cambios.activo,
          // Desactivar corta sus refresh tokens (igual que en la administración).
          ...(desactiva ? { versionSesion: { increment: 1 } } : {}),
        },
        select: SELECT_ADMIN,
      });
      const accion: AccionBitacora = desactiva
        ? 'admin.desactivar'
        : cambios.activo === true && !antes.activo
          ? 'admin.reactivar'
          : 'admin.editar';
      await escribirBitacora(tx, actor, {
        accion,
        recurso: 'usuario',
        recursoId: id,
        antes: adminJson(antes),
        despues: adminJson(admin),
      });
      return admin;
    });
  }

  /**
   * "Convertir una cuenta de cliente": un usuario de empresa (admin_empresa o visor) pasa a
   * admin_global SIN cambiarle correo ni contraseña. Deja de pertenecer a su empresa (un
   * admin_global no lleva empresa: CHECK `usuarios_rol_empresa_chk`); la empresa sigue igual, con
   * sus demás usuarios. Se incrementa su `versionSesion`: su sesión de cliente no se reusa como
   * sesión de administrador. Devuelve si la empresa se quedó sin admin_empresa activo.
   */
  convertirCuenta(
    usuarioId: string,
  ): Promise<{ admin: AdminGuardado; empresaId: string; empresaSinAdmin: boolean }> {
    return this.#correr(async (tx, actor) => {
      await bloquearAdmins(tx);
      // Otra vez, YA con el candado: si otro admin lo desactivó mientras esperaba, no sigue.
      await actorVigente(tx, actor.id);
      const antes = await tx.usuario.findFirst({
        where: { id: usuarioId, rol: { in: [RolUsuario.admin_empresa, RolUsuario.visor] } },
        select: { ...SELECT_ADMIN, empresa: { select: { id: true, nombre: true } } },
      });
      if (!antes || antes.empresaId === null || !antes.empresa) {
        throw new NotFoundException('Recurso no encontrado');
      }
      if (!antes.activo) {
        throw new BadRequestException(
          'La cuenta está desactivada: reactívala antes de convertirla',
        );
      }
      const admin = await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          rol: RolUsuario.admin_global,
          empresaId: null,
          versionSesion: { increment: 1 },
        },
        select: SELECT_ADMIN,
      });
      const quedan = await tx.usuario.count({
        where: { empresaId: antes.empresaId, rol: RolUsuario.admin_empresa, activo: true },
      });
      await escribirBitacora(tx, actor, {
        accion: 'admin.convertir_cuenta',
        empresaId: antes.empresaId,
        recurso: 'usuario',
        recursoId: usuarioId,
        antes: {
          ...adminJson(antes),
          empresaId: antes.empresaId,
          empresa: antes.empresa.nombre,
        },
        despues: { ...adminJson(admin), empresaId: null, empresaSinAdmin: quedan === 0 },
      });
      return { admin, empresaId: antes.empresaId, empresaSinAdmin: quedan === 0 };
    });
  }

  // --- Ajustes globales ------------------------------------------------------------------------

  guardarAjustes(colorAcento: string | null): Promise<{ colorAcento: string | null }> {
    return this.#correr(async (tx, actor) => {
      const antes = await tx.configuracionPlataforma.findFirst({
        where: { id: 1 },
        select: { colorAcento: true },
      });
      const despues = await tx.configuracionPlataforma.upsert({
        where: { id: 1 },
        create: { id: 1, colorAcento, updatedAt: new Date() },
        update: { colorAcento, updatedAt: new Date() },
        select: { colorAcento: true },
      });
      await escribirBitacora(tx, actor, {
        accion: 'ajustes.editar',
        recurso: 'ajustes',
        antes: { colorAcento: antes?.colorAcento ?? null },
        despues,
      });
      return despues;
    });
  }
}

/**
 * Los ajustes PÚBLICOS de la plataforma (el color de la interfaz): los lee el login antes de que
 * haya sesión. Sin tenant: la tabla no tiene empresa y nada de lo que devuelve es de una.
 */
export class LecturaAparienciaPlataforma {
  readonly #cliente: Pick<Tx, 'configuracionPlataforma'>;

  constructor(cliente: Pick<Tx, 'configuracionPlataforma'>) {
    this.#cliente = cliente;
  }

  async colorAcento(): Promise<string | null> {
    const fila = await this.#cliente.configuracionPlataforma.findFirst({
      where: { id: 1 },
      select: { colorAcento: true },
    });
    return fila?.colorAcento ?? null;
  }
}

/** El 409 del límite de sucursales: el web lo distingue por `codigo`. */
export class LimiteSucursalesExcedido extends ConflictException {
  constructor(mensaje: string, limite: number, activas: number, plan: string) {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: mensaje,
      codigo: 'limite_sucursales',
      limite,
      activas,
      plan,
    });
  }
}

/**
 * El límite de sucursales del plan, al dar de alta o reactivar una sucursal. Bajo el candado de
 * la suscripción de la empresa (dos altas simultáneas no se cuelan las dos por el último cupo).
 * Sin suscripción, o con plan ilimitado, no hay límite. Por encima del límite: 409 para
 * admin_empresa; un admin_global puede forzarlo con `forzar` (queda en la bitácora).
 */
export class CupoSucursales {
  readonly #cliente: ClientePlataforma;
  readonly #scope: EmpresaScope;
  readonly #actorId: string;

  constructor(cliente: ClientePlataforma, scope: EmpresaScope, actorId: string) {
    this.#cliente = cliente;
    this.#scope = scope;
    this.#actorId = actorId;
  }

  /** Alta de sucursal en una empresa del alcance (fuera de él = 404), respetando el cupo. */
  crearSucursal(
    empresaId: string,
    datos: { nombre: string; zonaHoraria: string },
    forzar: boolean,
  ) {
    return enTransaccion(this.#cliente, async (tx) => {
      const empresa = encontradoOr404(
        await tx.empresa.findFirst({
          where: whereScoped(this.#scope, 'Empresa', { id: empresaId }),
          select: { id: true },
        }),
      );
      const forzada = await this.#verificarCupo(tx, empresa.id, forzar);
      const sucursal = await new EscrituraAdmin(tx, this.#scope).crearSucursal(empresa.id, datos);
      if (forzada) await this.#bitacoraForzada(tx, empresa.id, forzada, 'alta', sucursal.id);
      return sucursal;
    });
  }

  /**
   * El PATCH de una sucursal (nombre, zona, alta/baja) en UNA transacción. Si la reactiva (estaba
   * inactiva y llega `activo: true`), el cupo se revisa bajo el candado de la suscripción y el
   * UPDATE va en la misma transacción: dos reactivaciones simultáneas no se cuelan las dos por
   * el último cupo, y la bitácora de "forzó el límite" sólo queda si el UPDATE ocurrió.
   * Fuera del alcance (o inexistente): 404.
   */
  editarSucursal(
    sucursalId: string,
    data: { nombre?: string; zonaHoraria?: string; activo?: boolean },
    forzar: boolean,
  ) {
    return enTransaccion(this.#cliente, async (tx) => {
      const donde = whereScoped(this.#scope, 'Sucursal', { id: sucursalId });
      const actual = encontradoOr404(
        await tx.sucursal.findFirst({ where: donde, select: { empresaId: true, activo: true } }),
      );
      const forzada =
        data.activo === true && !actual.activo
          ? await this.#verificarCupo(tx, actual.empresaId, forzar)
          : null;
      const { count } = await tx.sucursal.updateMany({ where: donde, data });
      encontradoOr404(count === 1 ? count : null);
      if (forzada) {
        await this.#bitacoraForzada(tx, actual.empresaId, forzada, 'reactivacion', sucursalId);
      }
      return encontradoOr404(
        await tx.sucursal.findFirst({ where: donde, select: SELECT_SUCURSAL }),
      );
    });
  }

  /**
   * Con el candado de la suscripción: ¿cabe una sucursal activa más? Si no cabe, 409; salvo un
   * admin_global con `forzar`, que pasa (devuelve el cupo para la bitácora, que el caller
   * escribe DESPUÉS de su escritura). Sin suscripción o ilimitado: null.
   */
  async #verificarCupo(
    tx: Tx,
    empresaId: string,
    forzar: boolean,
  ): Promise<{ plan: string; limite: number; activas: number } | null> {
    const suscripcion = await bloquearSuscripcion(tx, empresaId);
    const limite = suscripcion?.plan.limiteSucursales ?? null;
    if (!suscripcion || limite === null) return null;
    const activas = await tx.sucursal.count({ where: { empresaId, activo: true } });
    if (activas < limite) return null;
    const esGlobal = this.#scope.tipo === 'global';
    if (!esGlobal || !forzar) {
      throw new LimiteSucursalesExcedido(
        mensajeLimiteSucursales(esGlobal, suscripcion.plan.nombre, limite, activas),
        limite,
        activas,
        suscripcion.plan.nombre,
      );
    }
    return { plan: suscripcion.plan.nombre, limite, activas };
  }

  async #bitacoraForzada(
    tx: Tx,
    empresaId: string,
    cupo: { plan: string; limite: number; activas: number },
    motivo: 'alta' | 'reactivacion',
    sucursalId: string,
  ): Promise<void> {
    await escribirBitacora(tx, await actorVigente(tx, this.#actorId), {
      accion: 'sucursal.forzar_limite',
      empresaId,
      recurso: 'empresa',
      recursoId: empresaId,
      antes: cupo,
      despues: { motivo, sucursalId, activas: cupo.activas + 1 },
    });
  }
}
