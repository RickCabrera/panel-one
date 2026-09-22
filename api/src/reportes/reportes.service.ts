import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EstadoEnvioReporte,
  type RolUsuario,
  type TipoAlerta,
  type TipoReporte,
} from '@prisma/client';

import { PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import type { PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import { Auditoria } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { scopeDeUsuario, type EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import { tokenBaja, verificarTokenBaja } from './baja';
import {
  HORA_ENVIO,
  periodoDeHoy,
  reportesQueTocan,
  restarDias,
  zonaDeEmpresa,
  type PeriodoReporte,
} from './calendario';
import { REPORTES_CONFIG, type ReportesConfig } from './config';
import {
  comparar,
  diasSemanales,
  filasSemanales,
  type AlertasReporte,
  type ConteoAlertas,
  type ContenidoReporte,
  type EmpresaReporte,
} from './contenido';
import { renderizar } from './plantillas';

/**
 * Reportes programados por correo (F2-141).
 *
 * - Suscripción por (usuario, empresa): cada quien activa el diario y/o el semanal para sí
 *   mismo. La empresa se verifica con el scope del token (404 fuera de alcance).
 * - Las cifras salen de `AgregadosVentasService`, con el scope del DESTINATARIO: si ya no ve
 *   la empresa, no hay correo (el envío queda `descartado`).
 * - Idempotencia: cada envío se reclama en `envios_reporte` antes de mandar (único por
 *   suscripción, tipo y periodo). Ver `EscrituraReportes`.
 */

/** El programador recorre todas las empresas: su scope es el global, como el de alertas. */
const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };
const MS_DIA = 86_400_000;
const ULTIMOS_ENVIOS = 10;

export interface UsuarioReportes {
  id: string;
  rol: RolUsuario;
}

export interface EnvioVista {
  tipo: TipoReporte;
  periodo: string;
  estado: EstadoEnvioReporte;
  intentos: number;
  creadoAt: string;
  enviadoAt: string | null;
}

export interface SuscripcionVista {
  empresaId: string;
  diario: boolean;
  semanal: boolean;
  zonaHoraria: string;
  horaEnvio: number;
  ultimosEnvios: EnvioVista[];
}

export interface VistaPrevia {
  tipo: TipoReporte;
  periodo: string;
  asunto: string;
  html: string;
  texto: string;
}

export interface ResultadoVuelta {
  enviados: number;
  fallidos: number;
}

interface SuscripcionAEnviar {
  id: string;
  empresaId: string;
  diario: boolean;
  semanal: boolean;
  usuario: { id: string; email: string; nombre: string; rol: RolUsuario; empresaId: string | null };
  empresa: { nombre: string; sucursales: Array<{ zonaHoraria: string }> };
}

const MENSAJE_BAJA_INVALIDA = 'El enlace para dejar de recibir reportes no es válido.';

function contar(tipos: TipoAlerta[]): ConteoAlertas[] {
  const m = new Map<TipoAlerta, number>();
  for (const t of tipos) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([tipo, cuentas]) => ({ tipo, cuentas }));
}

@Injectable()
export class ReportesService {
  private readonly logger = new Logger('Reportes');

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly agregados: AgregadosVentasService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_CORREO) private readonly correo: PuertoCorreo,
    @Inject(REPORTES_CONFIG) private readonly config: ReportesConfig,
  ) {}

  // ------------------------------------------------------------ suscripción

  private async empresaReporte(scope: EmpresaScope, empresaId: string): Promise<EmpresaReporte> {
    const datos = this.datos.para(scope);
    const empresa = encontradoOr404(
      await datos.empresa.findFirst({
        where: { id: empresaId },
        select: { id: true, nombre: true },
      }),
    );
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId, activo: true },
      select: { zonaHoraria: true },
    });
    return {
      id: empresa.id,
      nombre: empresa.nombre,
      zona: zonaDeEmpresa(sucursales.map((s) => s.zonaHoraria)),
    };
  }

  async suscripcion(
    usuario: UsuarioReportes,
    scope: EmpresaScope,
    empresaId: string,
  ): Promise<SuscripcionVista> {
    const empresa = await this.empresaReporte(scope, empresaId);
    const datos = this.datos.para(scope);
    const fila = await datos.suscripcionReporte.findFirst({
      where: { usuarioId: usuario.id, empresaId },
      select: { id: true, diario: true, semanal: true },
    });
    const envios = fila
      ? await datos.envioReporte.findMany({
          where: { suscripcionId: fila.id, empresaId },
          orderBy: [{ creadoAt: 'desc' }, { tipo: 'asc' }],
          take: ULTIMOS_ENVIOS,
          select: {
            tipo: true,
            periodo: true,
            estado: true,
            intentos: true,
            creadoAt: true,
            enviadoAt: true,
          },
        })
      : [];
    return {
      empresaId,
      diario: fila?.diario ?? false,
      semanal: fila?.semanal ?? false,
      zonaHoraria: empresa.zona,
      horaEnvio: HORA_ENVIO,
      ultimosEnvios: envios.map((e) => ({
        tipo: e.tipo,
        periodo: e.periodo,
        estado: e.estado,
        intentos: e.intentos,
        creadoAt: e.creadoAt.toISOString(),
        enviadoAt: e.enviadoAt?.toISOString() ?? null,
      })),
    };
  }

  async guardar(
    usuario: UsuarioReportes,
    scope: EmpresaScope,
    empresaId: string,
    valores: { diario: boolean; semanal: boolean },
  ): Promise<SuscripcionVista> {
    const guardada = await this.datos
      .reportes(scope)
      .guardarSuscripcion(usuario.id, empresaId, valores);
    this.auditoria.registrar(usuario, {
      accion: 'suscripcion_reporte.editar',
      recurso: 'suscripcion_reporte',
      recursoId: guardada.id,
      empresaId,
      campos: ['diario', 'semanal'],
    });
    return this.suscripcion(usuario, scope, empresaId);
  }

  /** El correo que tocaría HOY (sin importar la hora), para revisarlo sin esperar a las 7. */
  async vistaPrevia(
    usuario: UsuarioReportes,
    scope: EmpresaScope,
    empresaId: string,
    tipo: TipoReporte,
  ): Promise<VistaPrevia> {
    const empresa = await this.empresaReporte(scope, empresaId);
    const periodo = periodoDeHoy(this.reloj.ahora(), empresa.zona, tipo);
    const contenido = await this.armar(scope, empresa, periodo);
    const fila = await this.datos.para(scope).suscripcionReporte.findFirst({
      where: { usuarioId: usuario.id, empresaId },
      select: { id: true },
    });
    const plantilla = renderizar(contenido, this.enlaces(empresa, periodo, fila?.id ?? null));
    return { tipo, periodo: periodo.periodo, ...plantilla };
  }

  // ------------------------------------------------------------ contenido

  private async alertas(scope: EmpresaScope, empresaId: string): Promise<AlertasReporte> {
    const datos = this.datos.para(scope);
    const desde = new Date(this.reloj.ahora() - MS_DIA);
    const [abiertas, recientes] = await Promise.all([
      datos.alerta.findMany({ where: { empresaId, cerradaAt: null }, select: { tipo: true } }),
      datos.alerta.findMany({
        where: { empresaId, abiertaAt: { gte: desde } },
        select: { tipo: true },
      }),
    ]);
    return {
      abiertas: contar(abiertas.map((a) => a.tipo)),
      ultimas24h: contar(recientes.map((a) => a.tipo)),
    };
  }

  /** Arma el contenido con los MISMOS servicios y filtros que el panel. */
  async armar(
    scope: EmpresaScope,
    empresa: EmpresaReporte,
    periodo: PeriodoReporte,
  ): Promise<ContenidoReporte> {
    const filtro = { empresaId: empresa.id, desde: periodo.desde, hasta: periodo.hasta };
    if (periodo.tipo === 'diario') {
      const [resumen, sucursales, top, alertas] = await Promise.all([
        this.agregados.resumen(scope, filtro),
        this.agregados.comparativoSucursales(scope, filtro),
        this.agregados.topProductos(scope, filtro, { por: 'importe', limite: 5 }),
        this.alertas(scope, empresa.id),
      ]);
      return { tipo: 'diario', empresa, periodo, resumen, sucursales, top, alertas };
    }
    const anterior = {
      desde: restarDias(periodo.desde, 7),
      hasta: restarDias(periodo.hasta, 7),
    };
    const filtroAnterior = { empresaId: empresa.id, ...anterior };
    const [resumen, resumenAnterior, sucursales, sucursalesAnt, dias, diasAnt] = await Promise.all([
      this.agregados.resumen(scope, filtro),
      this.agregados.resumen(scope, filtroAnterior),
      this.agregados.comparativoSucursales(scope, filtro),
      this.agregados.comparativoSucursales(scope, filtroAnterior),
      this.agregados.porDia(scope, filtro),
      this.agregados.porDia(scope, filtroAnterior),
    ]);
    return {
      tipo: 'semanal',
      empresa,
      periodo,
      anterior,
      resumen,
      resumenAnterior,
      ...comparar(resumen, resumenAnterior),
      sucursales: filasSemanales(sucursales, sucursalesAnt),
      dias: diasSemanales(dias, diasAnt),
    };
  }

  private enlaces(empresa: EmpresaReporte, periodo: PeriodoReporte, suscripcionId: string | null) {
    const panel = new URL(`${this.config.panelUrl}/resumen`);
    panel.searchParams.set('empresa', empresa.id);
    panel.searchParams.set('periodo', 'rango');
    panel.searchParams.set('desde', periodo.desde);
    panel.searchParams.set('hasta', periodo.hasta);
    let baja: string | null = null;
    if (suscripcionId !== null) {
      const url = new URL(`${this.config.panelUrl}/reportes/baja`);
      url.searchParams.set('t', tokenBaja(this.config.claveBaja, suscripcionId));
      url.searchParams.set('tipo', periodo.tipo);
      baja = url.toString();
    }
    return { panel: panel.toString(), baja };
  }

  // ------------------------------------------------------------ envío

  /**
   * Una vuelta del programador: para cada suscripción activa (usuario y empresa activos),
   * los reportes que tocan en este instante en la zona de su empresa. Cada uno se reclama
   * antes de mandarlo; uno fallido de HOY se reintenta hasta `MAX_INTENTOS_ENVIO`. Una
   * suscripción que falla no detiene a las demás.
   */
  async vuelta(): Promise<ResultadoVuelta> {
    const resultado: ResultadoVuelta = { enviados: 0, fallidos: 0 };
    const suscripciones = (await this.datos.para(SCOPE_SISTEMA).suscripcionReporte.findMany({
      where: {
        OR: [{ diario: true }, { semanal: true }],
        usuario: { activo: true },
        empresa: { activo: true },
      },
      select: {
        id: true,
        empresaId: true,
        diario: true,
        semanal: true,
        usuario: { select: { id: true, email: true, nombre: true, rol: true, empresaId: true } },
        empresa: {
          select: {
            nombre: true,
            sucursales: { where: { activo: true }, select: { zonaHoraria: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    })) as SuscripcionAEnviar[];

    for (const s of suscripciones) {
      try {
        await this.atender(s, resultado);
      } catch (error) {
        this.logger.warn(`No se atendió la suscripción ${s.id}: ${String(error)}`);
      }
    }
    return resultado;
  }

  private async atender(s: SuscripcionAEnviar, resultado: ResultadoVuelta): Promise<void> {
    const empresa: EmpresaReporte = {
      id: s.empresaId,
      nombre: s.empresa.nombre,
      zona: zonaDeEmpresa(s.empresa.sucursales.map((x) => x.zonaHoraria)),
    };
    const ahora = this.reloj.ahora();
    const escritura = this.datos.reportes(SCOPE_SISTEMA);
    for (const periodo of reportesQueTocan(ahora, empresa.zona)) {
      if (!s[periodo.tipo]) continue;
      let envioId = await escritura.reclamarEnvio(
        s.id,
        periodo.tipo,
        periodo.periodo,
        new Date(ahora),
      );
      if (envioId === null) {
        const fallido = await this.datos.para(SCOPE_SISTEMA).envioReporte.findFirst({
          where: {
            suscripcionId: s.id,
            tipo: periodo.tipo,
            periodo: periodo.periodo,
            estado: EstadoEnvioReporte.fallido,
          },
          select: { id: true },
        });
        if (fallido && (await escritura.reintentar(fallido.id))) envioId = fallido.id;
      }
      if (envioId === null) continue;
      if (await this.enviar(s, empresa, periodo, envioId)) resultado.enviados++;
      else resultado.fallidos++;
    }
  }

  private async enviar(
    s: SuscripcionAEnviar,
    empresa: EmpresaReporte,
    periodo: PeriodoReporte,
    envioId: string,
  ): Promise<boolean> {
    const escritura = this.datos.reportes(SCOPE_SISTEMA);
    let plantilla: PlantillaCorreo;
    try {
      // El scope del DESTINATARIO: si ya no ve la empresa, `consulta()` responde 404.
      const scope = scopeDeUsuario(s.usuario);
      const contenido = await this.armar(scope, empresa, periodo);
      plantilla = renderizar(contenido, this.enlaces(empresa, periodo, s.id));
    } catch (error) {
      const definitivo = error instanceof NotFoundException;
      await escritura.marcarFallido(
        envioId,
        definitivo ? 'El destinatario ya no puede ver esta empresa.' : String(error),
        definitivo,
      );
      return false;
    }
    try {
      const { id } = await this.correo.enviar(
        { email: s.usuario.email, nombre: s.usuario.nombre },
        plantilla,
        [],
        { empresaId: s.empresaId },
      );
      await escritura.marcarEnviado(envioId, id, new Date(this.reloj.ahora()));
      return true;
    } catch (error) {
      this.logger.warn(`Falló el envío ${envioId}: ${String(error)}`);
      await escritura.marcarFallido(envioId, String(error), false);
      return false;
    }
  }

  // ------------------------------------------------------------ baja

  /**
   * Baja SIN sesión: el token firmado es la credencial. Apaga ese tipo (o los dos) y
   * responde cómo quedó. Token inválido o suscripción inexistente: 404 con el mismo mensaje.
   * Repetirla no cambia nada.
   */
  async baja(token: string, tipo?: TipoReporte): Promise<{ diario: boolean; semanal: boolean }> {
    const id = verificarTokenBaja(this.config.claveBaja, token);
    if (id === null) throw new NotFoundException(MENSAJE_BAJA_INVALIDA);
    const datos = this.datos.para(SCOPE_SISTEMA);
    const { count } = await datos.suscripcionReporte.updateMany({
      where: { id },
      data: tipo === undefined ? { diario: false, semanal: false } : { [tipo]: false },
    });
    if (count === 0) throw new NotFoundException(MENSAJE_BAJA_INVALIDA);
    const fila = await datos.suscripcionReporte.findFirst({
      where: { id },
      select: { diario: true, semanal: true, empresaId: true },
    });
    this.logger.log(
      JSON.stringify({ accion: 'suscripcion_reporte.baja', recursoId: id, tipo: tipo ?? 'todos' }),
    );
    return { diario: fila?.diario ?? false, semanal: fila?.semanal ?? false };
  }
}
