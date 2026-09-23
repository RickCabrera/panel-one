import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import {
  esCodigoValido,
  estadoPublico,
  mensajeEstado,
  normalizarCodigo,
  periodoGlobalDe,
  type VigenciaCodigos,
} from './codigo';
import type {
  ConsultaCodigoDto,
  GuardarVigenciaCodigosDto,
  VigenciaCodigosDto,
} from './dto/codigo.dto';

export const MENSAJE_CODIGO_NO_ENCONTRADO = 'Código de facturación no encontrado.';
export const MENSAJE_CODIGO_FORMATO =
  'El código de facturación tiene 9 caracteres: letras y números, sin O, 0, I ni 1.';

/**
 * El código corto de facturación (F2-101): la consulta pública y la regla de vigencia por empresa.
 * Los códigos los crea la ingesta (`IngestaService`, en el savepoint de `OperacionesSucursal`).
 */
@Injectable()
export class CodigosFacturacionService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
  ) {}

  /**
   * Pública, sin sesión. Formato inválido = 400 sin tocar la base. No existe, o su sucursal o
   * empresa están inactivas = 404 (mismo cuerpo). Los datos del ticket salen SÓLO en `pendiente`:
   * un código expirado, facturado, en global o de una cuenta cancelada dice su estado y nada más.
   */
  async consultar(texto: string): Promise<ConsultaCodigoDto> {
    const codigo = normalizarCodigo(texto);
    if (!esCodigoValido(codigo)) throw new BadRequestException([MENSAJE_CODIGO_FORMATO]);
    const fila = await this.datos.codigoFacturacionPublico(codigo);
    if (!fila || !fila.sucursal.activo || !fila.sucursal.empresa.activo) {
      throw new NotFoundException(MENSAJE_CODIGO_NO_ENCONTRADO);
    }
    const estado = estadoPublico(fila, fila.cheque, this.reloj.ahora());
    const periodoGlobal = periodoGlobalDe(estado, fila.global, fila.sucursal.zonaHoraria);
    return {
      codigo: fila.codigo,
      estado,
      mensaje: mensajeEstado(estado, periodoGlobal),
      periodoGlobal,
      ticket:
        estado === 'pendiente'
          ? {
              sucursal: fila.sucursal.nombre,
              fecha: (fila.cheque.cerradoAt ?? fila.cheque.abiertoAt).toISOString(),
              zonaHoraria: fila.sucursal.zonaHoraria,
              total: fila.cheque.total.toFixed(2),
              expiraAt: fila.expiraAt.toISOString(),
            }
          : null,
    };
  }

  async vigencia(scope: EmpresaScope, empresaId: string): Promise<VigenciaCodigosDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const fila = await datos.configuracionFacturacion.findFirst({
      where: { empresaId },
      select: { vigenciaCodigos: true, vigenciaDias: true },
    });
    if (!fila) return { regla: 'fin_de_mes', dias: null, configurada: false };
    return {
      regla: fila.vigenciaCodigos,
      dias: fila.vigenciaCodigos === 'dias' ? fila.vigenciaDias : null,
      configurada: true,
    };
  }

  async guardarVigencia(
    scope: EmpresaScope,
    actor: Actor,
    dto: GuardarVigenciaCodigosDto,
  ): Promise<VigenciaCodigosDto> {
    // Alcance ANTES que cualquier 400 de negocio: una empresa ajena no aprende nada.
    await verificarAlcance(this.datos.para(scope), dto.empresaId);
    if (dto.regla === 'fin_de_mes' && dto.dias !== undefined) {
      throw new BadRequestException(['dias sólo va con la regla dias']);
    }
    const vigencia: VigenciaCodigos =
      dto.regla === 'dias' ? { regla: 'dias', dias: dto.dias! } : { regla: 'fin_de_mes' };
    await this.datos
      .facturacion(scope)
      .guardarVigenciaCodigos(dto.empresaId, vigencia, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'vigencia_codigos.editar',
      recurso: 'configuracion_facturacion',
      recursoId: dto.empresaId,
      empresaId: dto.empresaId,
      campos: dto.regla === 'dias' ? ['regla', 'dias'] : ['regla'],
    });
    return this.vigencia(scope, dto.empresaId);
  }
}
