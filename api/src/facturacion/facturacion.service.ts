import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ADAPTADORES_CONFIG, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import type { AdaptadoresConfig } from '../adaptadores/config';
import { ErrorTimbrado, type PuertoTimbrado } from '../adaptadores/timbrado/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { ErrorCsd, leerCsd } from './csd';
import type {
  CargarCsdDto,
  GuardarPerfilFiscalDto,
  GuardarPerfilRespuestaDto,
  PerfilFiscalDto,
  RespuestaPerfilFiscalDto,
} from './dto/facturacion.dto';
import { MAX_BYTES_ARCHIVO_CSD } from './dto/facturacion.dto';
import { normalizarRfc, regimenAplica, RFC_GENERICOS, tipoPersona } from './sat';

const SELECCION_PERFIL = {
  rfc: true,
  razonSocial: true,
  regimenFiscal: true,
  cp: true,
  serie: true,
  folioActual: true,
  activo: true,
  facturamaOrgId: true,
  csdNoCertificado: true,
  csdRfc: true,
  csdVigenteDesde: true,
  csdVigenteHasta: true,
  csdCargadoAt: true,
  updatedAt: true,
} as const;

type FilaPerfil = {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  serie: string;
  folioActual: number;
  activo: boolean;
  facturamaOrgId: string | null;
  csdNoCertificado: string | null;
  csdRfc: string | null;
  csdVigenteDesde: Date | null;
  csdVigenteHasta: Date | null;
  csdCargadoAt: Date | null;
  updatedAt: Date;
};

function aDto(p: FilaPerfil): PerfilFiscalDto {
  const conCsd =
    p.csdNoCertificado !== null &&
    p.csdRfc !== null &&
    p.csdVigenteDesde !== null &&
    p.csdVigenteHasta !== null &&
    p.csdCargadoAt !== null;
  return {
    rfc: p.rfc,
    razonSocial: p.razonSocial,
    regimenFiscal: p.regimenFiscal,
    cp: p.cp,
    serie: p.serie,
    folioActual: p.folioActual,
    activo: p.activo,
    emisorRegistrado: p.facturamaOrgId !== null,
    csd: conCsd
      ? {
          noCertificado: p.csdNoCertificado!,
          rfc: p.csdRfc!,
          vigenteDesde: p.csdVigenteDesde!.toISOString(),
          vigenteHasta: p.csdVigenteHasta!.toISOString(),
          cargadoAt: p.csdCargadoAt!.toISOString(),
        }
      : null,
    actualizadoAt: p.updatedAt.toISOString(),
  };
}

/** Un archivo del CSD, ya validado como base64 por el DTO: vacío o de más = 400. */
function archivo(nombre: string, base64: string): Buffer {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new BadRequestException([`${nombre} está vacío`]);
  if (bytes.length > MAX_BYTES_ARCHIVO_CSD) {
    throw new BadRequestException([`${nombre} pesa más de ${MAX_BYTES_ARCHIVO_CSD / 1024} KB`]);
  }
  return bytes;
}

/**
 * Datos fiscales y CSD de una empresa (F2-100). Lecturas por `para(scope)`, escrituras por
 * `facturacion(scope)`; fuera de alcance = 404, nunca 403.
 *
 * El CSD sigue un solo camino, y en este orden: empresa en alcance (404) → hay perfil (409) →
 * validación local (400, `csd.ts`) → alta en el PAC por `PUERTO_TIMBRADO` (400 / 503) → SÓLO
 * ENTONCES se guarda la metadata. Si algo falla, no se escribe nada. El `.key` y la contraseña
 * viven en memoria durante la petición: no se guardan, no se loguean, no van en ningún error, y la
 * auditoría sólo registra NOMBRES de campos.
 */
@Injectable()
export class FacturacionService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_TIMBRADO) private readonly pac: PuertoTimbrado,
    @Inject(ADAPTADORES_CONFIG) private readonly config: AdaptadoresConfig,
  ) {}

  private get pacSimulado(): boolean {
    return this.config.pac.impl === 'falso';
  }

  private async leerPerfil(
    scope: EmpresaScope,
    empresaId: string,
  ): Promise<PerfilFiscalDto | null> {
    const fila = await this.datos
      .para(scope)
      .perfilFiscal.findFirst({ where: { empresaId }, select: SELECCION_PERFIL });
    return fila ? aDto(fila) : null;
  }

  async perfil(scope: EmpresaScope, empresaId: string): Promise<RespuestaPerfilFiscalDto> {
    await verificarAlcance(this.datos.para(scope), empresaId);
    return { perfil: await this.leerPerfil(scope, empresaId), pacSimulado: this.pacSimulado };
  }

  async guardarPerfil(
    scope: EmpresaScope,
    actor: Actor,
    dto: GuardarPerfilFiscalDto,
  ): Promise<GuardarPerfilRespuestaDto> {
    const rfc = normalizarRfc(dto.rfc);
    const tipo = tipoPersona(rfc);
    if (!tipo) throw new BadRequestException(['rfc no tiene el formato del SAT']);
    if (RFC_GENERICOS.includes(rfc)) {
      throw new BadRequestException(['un RFC genérico no puede ser el emisor']);
    }
    if (!regimenAplica(dto.regimenFiscal, tipo)) {
      throw new BadRequestException([
        `el régimen ${dto.regimenFiscal} no existe o no aplica a persona ${tipo === 'moral' ? 'moral' : 'física'}`,
      ]);
    }
    const { creado, csdQuitado } = await this.datos.facturacion(scope).guardarPerfil(
      dto.empresaId,
      {
        rfc,
        razonSocial: dto.razonSocial.trim(),
        regimenFiscal: dto.regimenFiscal,
        cp: dto.cp,
        serie: dto.serie,
      },
      actor.id,
      new Date(this.reloj.ahora()),
    );
    this.auditoria.registrar(actor, {
      accion: 'perfil_fiscal.editar',
      recurso: 'perfil_fiscal',
      recursoId: dto.empresaId,
      empresaId: dto.empresaId,
      campos: [
        ...(creado ? ['creado'] : []),
        'rfc',
        'razonSocial',
        'regimenFiscal',
        'cp',
        'serie',
        ...(csdQuitado ? ['csd_quitado'] : []),
      ],
    });
    return {
      perfil: await this.leerPerfil(scope, dto.empresaId),
      pacSimulado: this.pacSimulado,
      csdQuitado,
    };
  }

  async cargarCsd(
    scope: EmpresaScope,
    actor: Actor,
    dto: CargarCsdDto,
  ): Promise<RespuestaPerfilFiscalDto> {
    const escritura = this.datos.facturacion(scope);
    // 1. Empresa en alcance (404) ANTES que cualquier otra respuesta.
    const perfil = await escritura.perfilDe(dto.empresaId);
    if (!perfil) {
      throw new ConflictException(
        'Guarda primero los datos fiscales de la empresa: el CSD se valida contra su RFC.',
      );
    }
    const certificado = archivo('certificado', dto.certificado);
    const llavePrivada = archivo('llavePrivada', dto.llavePrivada);
    const ahora = new Date(this.reloj.ahora());

    // 2. Validación local: .cer, .key, contraseña, correspondencia, RFC y vigencia.
    let metadata;
    try {
      metadata = leerCsd(
        { certificado, llavePrivada, contrasena: dto.contrasena },
        perfil.rfc,
        ahora,
      );
    } catch (e) {
      if (e instanceof ErrorCsd) throw new BadRequestException([e.message]);
      throw e;
    }

    // 3. Alta en el PAC. Su error ya viene sin secretos (ver `errorCsdDe`).
    let registrado;
    try {
      registrado = await this.pac.registrarCsd({
        rfc: perfil.rfc,
        certificado,
        llavePrivada,
        contrasena: dto.contrasena,
        reemplazar: perfil.facturamaOrgId !== null,
      });
    } catch (e) {
      if (e instanceof ErrorTimbrado) {
        if (e.reintentable) throw new ServiceUnavailableException(e.message);
        throw new BadRequestException([e.message]);
      }
      throw e;
    }

    // 4. Sólo ahora, la metadata.
    await escritura.guardarCsd(
      dto.empresaId,
      { rfcValidado: perfil.rfc, ...metadata, facturamaOrgId: registrado.idOrganizacion },
      actor.id,
      ahora,
    );
    this.auditoria.registrar(actor, {
      accion: 'perfil_fiscal.cargar_csd',
      recurso: 'perfil_fiscal',
      recursoId: dto.empresaId,
      empresaId: dto.empresaId,
      campos: ['csd_no_certificado', 'csd_vigencia', 'facturama_org_id'],
    });
    return { perfil: await this.leerPerfil(scope, dto.empresaId), pacSimulado: this.pacSimulado };
  }
}
