import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import type { PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { ConteoMensual } from '../scope/folios-plataforma';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type {
  AltaPaqueteFoliosDto,
  FoliosDto,
  PaqueteCreadoDto,
  ReporteFoliosDto,
  TotalMesDto,
} from './dto/folios.dto';
import {
  avisaVigencia,
  plantillaFoliosBajo,
  plantillaFoliosPorVencer,
  vigenciaDeCompra,
} from './folios';

/** El programador corre con el scope del sistema: el saldo es de la plataforma. */
const SISTEMA: EmpresaScope = { tipo: 'global' };
export const MAX_MESES_REPORTE = 24;

export const MENSAJE_FECHA_COMPRA_INVALIDA = 'La fecha de compra no es un día válido (AAAA-MM-DD).';
export const MENSAJE_FECHA_COMPRA_FUTURA = 'La fecha de compra no puede ser futura.';
export const MENSAJE_RANGO_REPORTE = `El rango del reporte va de un mes a otro posterior, con máximo ${MAX_MESES_REPORTE} meses.`;

/** Lo que hizo una vuelta de avisos (para el log y los tests). */
export interface ResultadoAvisos {
  umbral:
    | 'sin_control'
    | 'nada'
    | 'enviado'
    | 'fallido'
    | 'rearmado'
    | 'ya_avisado'
    | 'sin_destinatarios';
  vigenciaEnviados: number;
  vigenciaFallidos: number;
}

function mesesEntre(desde: string, hasta: string): string[] {
  const [a, m] = desde.split('-').map(Number);
  const [b, n] = hasta.split('-').map(Number);
  const total = (b - a) * 12 + (n - m) + 1;
  return Array.from({ length: Math.max(total, 0) }, (_, i) =>
    new Date(Date.UTC(a, m - 1 + i, 1)).toISOString().slice(0, 7),
  );
}

/**
 * El control de folios del PAC (F2-110): la vista del admin_global (saldo, paquetes, consumo por
 * empresa), el alta y la baja de paquetes, el umbral, el reporte mensual por empresa y la vuelta de
 * avisos por correo. Todo cruza empresas, así que todo va por `LecturaFoliosPlataforma` /
 * `EscrituraFolios` con scope global (lanzan con otro); nunca `prisma` directo.
 */
@Injectable()
export class FoliosService {
  readonly #log = new Logger('Folios');

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_CORREO) private readonly correo: PuertoCorreo,
    private readonly notificaciones: NotificacionesService,
  ) {}

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  async estado(scope: EmpresaScope): Promise<FoliosDto> {
    const ahora = this.#ahora();
    const lectura = this.datos.folios(scope);
    const e = await lectura.estado(ahora);
    return {
      control: e.control,
      umbralPct: e.umbralPct,
      estado: e.estado,
      disponible: e.disponible,
      vigenteTotal: e.vigenteTotal,
      enEmision: e.enEmision,
      sobregiro: e.sobregiro,
      avisoUmbralAt: e.avisoUmbralAt?.toISOString() ?? null,
      // Lo más nuevo arriba.
      paquetes: [...e.paquetes].reverse().map((p) => ({
        id: p.id,
        cantidad: p.cantidad,
        compradoAt: p.compradoAt.toISOString(),
        venceAt: p.venceAt.toISOString(),
        nota: p.nota,
        consumidos: p.consumidos,
        restantes: p.restantes,
        estado: p.estado,
        diasParaVencer: p.diasParaVencer,
      })),
      consumoPorEmpresa: await lectura.consumoPorEmpresa(ahora),
    };
  }

  async altaPaquete(
    scope: EmpresaScope,
    actor: Actor,
    dto: AltaPaqueteFoliosDto,
  ): Promise<PaqueteCreadoDto> {
    const ahora = this.#ahora();
    const vigencia = vigenciaDeCompra(dto.fechaCompra);
    if (!vigencia) throw new BadRequestException(MENSAJE_FECHA_COMPRA_INVALIDA);
    if (vigencia.compradoAt.getTime() > ahora.getTime()) {
      throw new BadRequestException(MENSAJE_FECHA_COMPRA_FUTURA);
    }
    const nota = dto.nota?.trim() ? dto.nota.trim() : null;
    const id = await this.datos
      .escrituraFolios(scope)
      .altaPaquete({ cantidad: dto.cantidad, ...vigencia, nota }, ahora);
    this.auditoria.registrar(actor, {
      accion: 'folios.paquete_alta',
      recurso: 'paquete_folios',
      recursoId: id,
      empresaId: null,
      campos: ['cantidad', 'compradoAt', 'nota'],
    });
    return { id };
  }

  async bajaPaquete(scope: EmpresaScope, actor: Actor, id: string): Promise<void> {
    await this.datos.escrituraFolios(scope).bajaPaquete(id, this.#ahora());
    this.auditoria.registrar(actor, {
      accion: 'folios.paquete_baja',
      recurso: 'paquete_folios',
      recursoId: id,
      empresaId: null,
    });
  }

  async guardarUmbral(scope: EmpresaScope, actor: Actor, umbralPct: number): Promise<FoliosDto> {
    await this.datos.escrituraFolios(scope).guardarUmbral(umbralPct, this.#ahora());
    this.auditoria.registrar(actor, {
      accion: 'folios.configurar',
      recurso: 'configuracion_folios',
      recursoId: '1',
      empresaId: null,
      campos: ['umbralPct'],
    });
    return this.estado(scope);
  }

  async reporte(scope: EmpresaScope, desde: string, hasta: string): Promise<ReporteFoliosDto> {
    const meses = mesesEntre(desde, hasta);
    if (meses.length === 0 || meses.length > MAX_MESES_REPORTE) {
      throw new BadRequestException(MENSAJE_RANGO_REPORTE);
    }
    const filas = await this.datos.folios(scope).reporteMensual(desde, hasta);
    const totales: TotalMesDto[] = meses.map((mes) => {
      const delMes = filas.filter((f) => f.mes === mes);
      const vigentes = delMes.reduce((a, f) => a + f.vigentes, 0);
      const cancelados = delMes.reduce((a, f) => a + f.cancelados, 0);
      return { mes, vigentes, cancelados, total: vigentes + cancelados };
    });
    return {
      desde,
      hasta,
      filas: filas.map((f: ConteoMensual) => ({ ...f, total: f.vigentes + f.cancelados })),
      totales,
    };
  }

  /**
   * Una vuelta de avisos (el programador, o un test con reloj falso):
   * - UMBRAL: saldo `bajo`/`agotado` sin aviso → se RECLAMA (sólo una vuelta gana) y se manda a cada
   *   admin_global activo; si el correo falla, se suelta el reclamo y la vuelta siguiente reintenta.
   *   Saldo `ok` con aviso puesto → se re-arma (el siguiente cruce vuelve a avisar).
   * - VIGENCIA: cada paquete con restante que vence en ≤ 30 días, una vez por paquete.
   *
   * DECISION PROVISIONAL (nocturno): el aviso de umbral NO va al centro de alertas (`folios_bajo`,
   * nota "Y además (de F2-224)"): las alertas son por empresa Y sucursal (`alertas.sucursal_id NOT
   * NULL`), las ven admin_empresa y visor, y el saldo es de la PLATAFORMA. Va por correo al
   * admin_global y se ve en Facturación → Folios. ❓ Decisión abierta para Ricardo: esquema-sr §2
   * "Control de folios (F2-110)" y nota en F2-250.
   */
  async vueltaAvisos(): Promise<ResultadoAvisos> {
    const ahora = this.#ahora();
    const lectura = this.datos.folios(SISTEMA);
    const escritura = this.datos.escrituraFolios(SISTEMA);
    const r: ResultadoAvisos = { umbral: 'nada', vigenciaEnviados: 0, vigenciaFallidos: 0 };
    const e = await lectura.estado(ahora);
    if (!e.control) return { ...r, umbral: 'sin_control' };
    const destinatarios = await lectura.destinatariosAvisos();

    if (e.estado === 'bajo' || e.estado === 'agotado') {
      if (e.avisoUmbralAt !== null) {
        r.umbral = 'ya_avisado';
      } else if (destinatarios.length === 0) {
        r.umbral = 'sin_destinatarios';
        this.#log.warn('Saldo de folios bajo y ningún admin_global activo a quien avisar.');
      } else if (await escritura.reclamarAvisoUmbral(ahora)) {
        const plantilla = plantillaFoliosBajo({
          estado: e.estado,
          disponible: e.disponible,
          vigenteTotal: e.vigenteTotal,
          umbralPct: e.umbralPct,
        });
        if (await this.#mandar(destinatarios, plantilla)) {
          r.umbral = 'enviado';
          // F2-146: el push va SÓLO cuando el correo salió. Si el correo falla, el reclamo se
          // suelta y se reintenta: mandar el push al reclamar lo repetiría en cada reintento.
          // Best-effort: `foliosBajo` nunca lanza.
          await this.notificaciones.foliosBajo({
            estado: e.estado,
            disponible: e.disponible,
            vigenteTotal: e.vigenteTotal,
            umbralPct: e.umbralPct,
          });
        } else {
          await escritura.soltarAvisoUmbral(ahora);
          r.umbral = 'fallido';
        }
      } else {
        r.umbral = 'ya_avisado';
      }
    } else if (e.avisoUmbralAt !== null) {
      await escritura.rearmarAvisoUmbral();
      r.umbral = 'rearmado';
    }

    if (destinatarios.length > 0) {
      for (const p of e.paquetes) {
        if (p.avisoVigenciaAt !== null || !avisaVigencia(p, ahora)) continue;
        if (!(await escritura.reclamarAvisoVigencia(p.id, ahora))) continue;
        if (await this.#mandar(destinatarios, plantillaFoliosPorVencer(p))) {
          r.vigenciaEnviados++;
        } else {
          await escritura.soltarAvisoVigencia(p.id, ahora);
          r.vigenciaFallidos++;
        }
      }
    }
    return r;
  }

  /** Manda a todos; `false` si alguno falló (el reclamo se suelta y se reintenta a todos). */
  async #mandar(
    destinatarios: ReadonlyArray<{ email: string; nombre: string }>,
    plantilla: PlantillaCorreo,
  ): Promise<boolean> {
    let ok = true;
    for (const d of destinatarios) {
      try {
        await this.correo.enviar({ email: d.email, nombre: d.nombre }, plantilla, []);
      } catch (error) {
        ok = false;
        this.#log.warn(
          `Aviso ${plantilla.nombre} sin enviar a un admin_global: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return ok;
  }
}
