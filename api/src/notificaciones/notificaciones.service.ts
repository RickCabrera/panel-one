import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, RolUsuario, TipoAlerta } from '@prisma/client';

import { PUERTO_PUSH } from '../adaptadores/adaptadores.module';
import { ADAPTADORES_CONFIG } from '../adaptadores/adaptadores.module';
import type { AdaptadoresConfig } from '../adaptadores/config';
import { llavesValidas, motivoEndpointInvalido } from '../adaptadores/push/endpoint';
import type { MensajePush, OpcionesPush, PuertoPush } from '../adaptadores/push/puerto';
import type { UsuarioToken } from '../auth/request-autenticado';
import { Auditoria } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { REFRESH_TTL_SEGUNDOS } from '../config/auth.config';
import { reportesQueTocan, zonaDeEmpresa } from '../reportes/calendario';
import type { EmpresaScope } from '../scope/empresa-scope';
import { scopeDeUsuario } from '../scope/empresa-scope';
import type { AlertaRecienAbierta } from '../scope/escritura-alertas';
import type { PreferenciasPush } from '../scope/escritura-push';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import {
  MENSAJE_PRUEBA,
  mensajeCierreDia,
  mensajeFoliosBajo,
  mensajeMesaAbierta,
  mensajeSucursalSinReporte,
  OPCIONES_ALERTA,
  OPCIONES_FOLIOS,
  OPCIONES_PRUEBA,
  OPCIONES_RESUMEN,
  type LugarAlerta,
  type SaldoFoliosBajo,
} from './mensajes';

/**
 * Notificaciones push (F2-146): qué quiere cada usuario, en qué navegadores, y a quién se
 * le manda cada aviso. Ver `docs/notificaciones.md`.
 *
 * Reglas que no se negocian:
 * - **Scope.** Una alerta de la empresa X sólo va a usuarios activos con `empresa_id = X` o
 *   admin_global. El resumen de una empresa se arma con el scope DEL DESTINATARIO.
 * - **Opt-in.** Sin preferencia guardada, nada. `folios_bajo` sólo para admin_global (se
 *   revisa al guardar Y al enviar).
 * - **Muere con la sesión.** Un dispositivo registrado con una `version_sesion` vieja, o sin
 *   renovarse en lo que dura una sesión, no recibe y se borra.
 * - **Best-effort.** Un push que falla no rompe la evaluación de alertas, ni el aviso de
 *   folios, ni una respuesta HTTP. Pérdidas conocidas en el doc.
 */

const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };

/** Lo que dura una sesión inactiva: un navegador que no abre el panel en ese lapso no recibe. */
export const VIGENCIA_DISPOSITIVO_MS = REFRESH_TTL_SEGUNDOS * 1000;

export type TipoNotificacion =
  'mesa_abierta' | 'sucursal_sin_reporte' | 'folios_bajo' | 'cierre_dia';

export const TIPOS_NOTIFICACION: readonly TipoNotificacion[] = [
  'mesa_abierta',
  'sucursal_sin_reporte',
  'folios_bajo',
  'cierre_dia',
];

/** Qué tipos puede prender un rol. `folios_bajo` es de la plataforma. */
export function tiposDisponibles(rol: RolUsuario): TipoNotificacion[] {
  return rol === RolUsuario.admin_global
    ? [...TIPOS_NOTIFICACION]
    : TIPOS_NOTIFICACION.filter((t) => t !== 'folios_bajo');
}

const PREFERENCIAS_APAGADAS: PreferenciasPush = {
  mesaAbierta: false,
  sucursalSinReporte: false,
  foliosBajo: false,
  cierreDia: false,
};

/** Columna de preferencia de cada tipo de alerta que manda push. */
const PREFERENCIA_DE_ALERTA: Partial<Record<TipoAlerta, keyof PreferenciasPush>> = {
  [TipoAlerta.mesa_abierta]: 'mesaAbierta',
  [TipoAlerta.sucursal_sin_reporte]: 'sucursalSinReporte',
};

/** ¿Este navegador sigue ligado a una sesión que podría estar viva? PURA. */
export function dispositivoVigente(
  d: { versionSesion: number; renovadoAt: Date },
  usuario: { versionSesion: number },
  ahoraMs: number,
): boolean {
  return (
    d.versionSesion === usuario.versionSesion &&
    ahoraMs - d.renovadoAt.getTime() <= VIGENCIA_DISPOSITIVO_MS
  );
}

export interface NotificacionesVista {
  clavePublica: string | null;
  preferencias: PreferenciasPush;
  disponibles: TipoNotificacion[];
  dispositivos: number;
}

export interface ResultadoEnvio {
  entregados: number;
  descartados: number;
  fallidos: number;
}

interface DispositivoAEnviar {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  versionSesion: number;
  renovadoAt: Date;
  usuario: { id: string; versionSesion: number };
}

const SELECT_DISPOSITIVO = {
  id: true,
  endpoint: true,
  p256dh: true,
  auth: true,
  versionSesion: true,
  renovadoAt: true,
  usuario: { select: { id: true, versionSesion: true } },
} as const;

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  /** Envíos en curso fuera del request (alertas): se encadenan para no saturar ni perderse. */
  #pendiente: Promise<void> = Promise.resolve();

  constructor(
    private readonly datos: ScopedPrismaService,
    @Inject(PUERTO_PUSH) private readonly push: PuertoPush,
    @Inject(ADAPTADORES_CONFIG) private readonly config: AdaptadoresConfig,
    private readonly reloj: Reloj,
    private readonly ventas: AgregadosVentasService,
    private readonly auditoria: Auditoria,
  ) {}

  // ------------------------------------------------------------ cuenta

  async vista(usuario: UsuarioToken): Promise<NotificacionesVista> {
    const scope = scopeDeUsuario(usuario);
    const datos = this.datos.para(scope);
    const [pref, dispositivos] = await Promise.all([
      datos.preferenciaPush.findFirst({
        where: { usuarioId: usuario.id },
        select: { mesaAbierta: true, sucursalSinReporte: true, foliosBajo: true, cierreDia: true },
      }),
      datos.dispositivoPush.count({ where: { usuarioId: usuario.id } }),
    ]);
    return {
      clavePublica: this.push.clavePublica,
      preferencias: pref ?? PREFERENCIAS_APAGADAS,
      disponibles: tiposDisponibles(usuario.rol),
      dispositivos,
    };
  }

  async guardarPreferencias(
    usuario: UsuarioToken,
    valores: PreferenciasPush,
  ): Promise<NotificacionesVista> {
    if (valores.foliosBajo && usuario.rol !== RolUsuario.admin_global) {
      throw new BadRequestException(
        'El aviso de saldo de folios sólo lo puede activar un administrador global.',
      );
    }
    const scope = scopeDeUsuario(usuario);
    await this.datos
      .push(scope)
      .guardarPreferencias({ id: usuario.id, empresaId: usuario.empresaId }, valores);
    this.auditoria.registrar(usuario, {
      accion: 'preferencia_push.editar',
      recurso: 'preferencia_push',
      recursoId: usuario.id,
      empresaId: usuario.empresaId,
      campos: ['mesaAbierta', 'sucursalSinReporte', 'foliosBajo', 'cierreDia'],
    });
    return this.vista(usuario);
  }

  /**
   * Registra (o renueva) el navegador del usuario. La respuesta es la MISMA si el endpoint
   * era nuevo, suyo o de otro usuario (reasignación con las mismas llaves): no revela nada.
   */
  async registrarDispositivo(
    usuario: UsuarioToken,
    nuevo: { endpoint: string; p256dh: string; auth: string },
  ): Promise<NotificacionesVista> {
    const motivo = motivoEndpointInvalido(nuevo.endpoint, this.config.push.hostsExtra);
    if (motivo !== null) throw new BadRequestException(motivo);
    if (!llavesValidas(nuevo.p256dh, nuevo.auth)) {
      throw new BadRequestException('Las llaves de la suscripción no son válidas.');
    }
    const scope = scopeDeUsuario(usuario);
    // La versión de sesión se lee de la base, nunca del cliente.
    const yo = await this.datos.para(scope).usuario.findFirst({
      where: { id: usuario.id, activo: true },
      select: { id: true, empresaId: true, versionSesion: true },
    });
    if (!yo) throw new BadRequestException('Tu usuario ya no está activo.');
    const ahora = new Date(this.reloj.ahora());
    let r;
    try {
      r = await this.datos.push(scope).guardarDispositivo(yo, nuevo, ahora);
    } catch (error) {
      // Dos registros simultáneos del MISMO endpoint nuevo: uno gana el único y el otro
      // reintenta una vez (ya lo encuentra y lo renueva).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      r = await this.datos.push(scope).guardarDispositivo(yo, nuevo, ahora);
    }
    if (r.resultado === 'llaves_distintas') {
      throw new BadRequestException(
        'La suscripción de este navegador no es válida. Desactiva y vuelve a activar las ' +
          'notificaciones en este dispositivo.',
      );
    }
    if (r.reasignadoDe !== null) {
      this.auditoria.registrar(usuario, {
        accion: 'dispositivo_push.reasignar',
        recurso: 'dispositivo_push',
        recursoId: r.id,
        empresaId: usuario.empresaId,
        campos: ['usuarioId'],
      });
    }
    return this.vista(usuario);
  }

  async quitarDispositivo(usuario: UsuarioToken, endpoint: string): Promise<NotificacionesVista> {
    await this.datos.push(scopeDeUsuario(usuario)).borrarDispositivo(usuario.id, endpoint);
    return this.vista(usuario);
  }

  /** Manda la notificación de prueba a los navegadores vigentes del usuario. */
  async prueba(usuario: UsuarioToken): Promise<ResultadoEnvio> {
    const dispositivos = (await this.datos.para(scopeDeUsuario(usuario)).dispositivoPush.findMany({
      where: { usuarioId: usuario.id, usuario: { activo: true } },
      select: SELECT_DISPOSITIVO,
      orderBy: { id: 'asc' },
    })) as DispositivoAEnviar[];
    return this.#mandar(dispositivos, () => MENSAJE_PRUEBA, OPCIONES_PRUEBA);
  }

  // ------------------------------------------------------------ disparos

  /**
   * Alertas recién abiertas (el centro de alertas llama DESPUÉS del commit). No espera el
   * envío: lo encadena y regresa, para que la vuelta del programador siga con las demás
   * empresas. `esperarPendientes()` lo deja terminar (tests y apagado).
   */
  alertasAbiertas(alertas: readonly AlertaRecienAbierta[]): void {
    const conPush = alertas.filter((a) => PREFERENCIA_DE_ALERTA[a.tipo] !== undefined);
    if (conPush.length === 0) return;
    this.#pendiente = this.#pendiente
      .then(() => this.#enviarAlertas(conPush))
      .catch((error: unknown) => {
        this.logger.warn(`Falló el push de ${conPush.length} alerta(s): ${String(error)}`);
      });
  }

  /** Espera los envíos encadenados por `alertasAbiertas`. */
  esperarPendientes(): Promise<void> {
    return this.#pendiente;
  }

  async #enviarAlertas(alertas: readonly AlertaRecienAbierta[]): Promise<void> {
    const datos = this.datos.para(SCOPE_SISTEMA);
    const sucursales = await datos.sucursal.findMany({
      where: { id: { in: [...new Set(alertas.map((a) => a.sucursalId))] } },
      select: { id: true, nombre: true, empresaId: true, empresa: { select: { nombre: true } } },
    });
    const lugarDe = new Map<string, LugarAlerta>(
      sucursales.map((s) => [
        s.id,
        { empresaId: s.empresaId, empresa: s.empresa.nombre, sucursalId: s.id, sucursal: s.nombre },
      ]),
    );
    for (const alerta of alertas) {
      const columna = PREFERENCIA_DE_ALERTA[alerta.tipo]!;
      const lugar = lugarDe.get(alerta.sucursalId);
      // La sucursal tiene que ser de la empresa de la alerta (la FK ya lo garantiza).
      if (!lugar || lugar.empresaId !== alerta.empresaId) continue;
      const dispositivos = (await datos.dispositivoPush.findMany({
        where: {
          usuario: {
            activo: true,
            OR: [{ rol: RolUsuario.admin_global }, { empresaId: alerta.empresaId }],
            preferenciaPush: { [columna]: true },
          },
        },
        select: SELECT_DISPOSITIVO,
        orderBy: { id: 'asc' },
      })) as DispositivoAEnviar[];
      const mensaje =
        alerta.tipo === TipoAlerta.mesa_abierta
          ? mensajeMesaAbierta(alerta.id, lugar, alerta.detalle)
          : mensajeSucursalSinReporte(alerta.id, lugar, alerta.detalle);
      await this.#mandar(dispositivos, () => mensaje, OPCIONES_ALERTA);
    }
  }

  /**
   * Saldo de folios bajo (lo llama `FoliosService` sólo cuando el correo del aviso SALIÓ): a
   * los admin_global activos con la preferencia. Best-effort: nunca lanza.
   */
  async foliosBajo(saldo: SaldoFoliosBajo): Promise<ResultadoEnvio> {
    try {
      const dispositivos = (await this.datos.para(SCOPE_SISTEMA).dispositivoPush.findMany({
        where: {
          usuario: {
            activo: true,
            rol: RolUsuario.admin_global,
            preferenciaPush: { foliosBajo: true },
          },
        },
        select: SELECT_DISPOSITIVO,
        orderBy: { id: 'asc' },
      })) as DispositivoAEnviar[];
      return await this.#mandar(dispositivos, () => mensajeFoliosBajo(saldo), OPCIONES_FOLIOS);
    } catch (error) {
      this.logger.warn(`Falló el push de folios bajo: ${String(error)}`);
      return { entregados: 0, descartados: 0, fallidos: 1 };
    }
  }

  /**
   * Una vuelta del resumen de cierre del día (el programador, o un test con reloj falso). Por
   * cada usuario con `cierre_dia` y navegadores vigentes, y por cada empresa activa de SU
   * scope: si en la zona de la empresa ya son las 07:00 (`HORA_ENVIO` de F2-141), se RECLAMA
   * `(usuario, empresa, ayer)` y se manda. Un usuario que falla no detiene a los demás.
   */
  async vueltaResumen(): Promise<ResultadoEnvio> {
    const total: ResultadoEnvio = { entregados: 0, descartados: 0, fallidos: 0 };
    const ahoraMs = this.reloj.ahora();
    const datos = this.datos.para(SCOPE_SISTEMA);
    const [usuarios, empresas] = await Promise.all([
      datos.usuario.findMany({
        where: {
          activo: true,
          preferenciaPush: { cierreDia: true },
          dispositivosPush: { some: {} },
        },
        select: { id: true, rol: true, empresaId: true },
        orderBy: { id: 'asc' },
      }),
      datos.empresa.findMany({
        where: { activo: true },
        select: {
          id: true,
          nombre: true,
          sucursales: { where: { activo: true }, select: { zonaHoraria: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    for (const u of usuarios) {
      const suyas =
        u.rol === RolUsuario.admin_global ? empresas : empresas.filter((e) => e.id === u.empresaId);
      for (const empresa of suyas) {
        const zona = zonaDeEmpresa(empresa.sucursales.map((s) => s.zonaHoraria));
        const diario = reportesQueTocan(ahoraMs, zona).find((p) => p.tipo === 'diario');
        if (!diario) continue;
        try {
          const r = await this.#resumenDe(u, empresa, diario.periodo, ahoraMs);
          total.entregados += r.entregados;
          total.descartados += r.descartados;
          total.fallidos += r.fallidos;
        } catch (error) {
          total.fallidos++;
          this.logger.warn(`Falló el resumen de ${u.id} / ${empresa.id}: ${String(error)}`);
        }
      }
    }
    return total;
  }

  async #resumenDe(
    u: { id: string; rol: RolUsuario; empresaId: string | null },
    empresa: { id: string; nombre: string },
    dia: string,
    ahoraMs: number,
  ): Promise<ResultadoEnvio> {
    const nada = { entregados: 0, descartados: 0, fallidos: 0 };
    const scope = scopeDeUsuario(u);
    const dispositivos = (await this.datos.para(scope).dispositivoPush.findMany({
      where: { usuarioId: u.id },
      select: SELECT_DISPOSITIVO,
      orderBy: { id: 'asc' },
    })) as DispositivoAEnviar[];
    // Sin un solo navegador vigente no se reclama: si renueva hoy, todavía le llega.
    if (!dispositivos.some((d) => dispositivoVigente(d, d.usuario, ahoraMs))) return nada;
    const ganado = await this.datos
      .push(scope)
      .reclamarResumen(u.id, empresa.id, dia, new Date(ahoraMs));
    if (!ganado) return nada;
    // El scope del DESTINATARIO: si ya no ve la empresa, `resumen()` responde 404 y no sale.
    const resumen = await this.ventas.resumen(scope, {
      empresaId: empresa.id,
      desde: dia,
      hasta: dia,
    });
    return this.#mandar(
      dispositivos,
      () => mensajeCierreDia(empresa, dia, resumen),
      OPCIONES_RESUMEN,
    );
  }

  // ------------------------------------------------------------ envío

  /**
   * Manda a cada navegador VIGENTE; los de una sesión muerta y los que el servicio da por
   * caducados se borran. Uno que falla no detiene a los demás.
   */
  async #mandar(
    dispositivos: readonly DispositivoAEnviar[],
    mensaje: () => MensajePush,
    opciones: OpcionesPush,
  ): Promise<ResultadoEnvio> {
    const r: ResultadoEnvio = { entregados: 0, descartados: 0, fallidos: 0 };
    const ahoraMs = this.reloj.ahora();
    const descartar: string[] = [];
    for (const d of dispositivos) {
      if (!dispositivoVigente(d, d.usuario, ahoraMs)) {
        descartar.push(d.id);
        continue;
      }
      try {
        const resultado = await this.push.enviar(
          { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
          mensaje(),
          opciones,
        );
        if (resultado === 'caducado') descartar.push(d.id);
        else r.entregados++;
      } catch (error) {
        r.fallidos++;
        this.logger.warn(`Falló un push al dispositivo ${d.id}: ${String(error)}`);
      }
    }
    r.descartados = await this.datos.push(SCOPE_SISTEMA).descartarDispositivos(descartar);
    return r;
  }
}
