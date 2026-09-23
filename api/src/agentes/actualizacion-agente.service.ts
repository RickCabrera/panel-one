import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { PUERTO_ARCHIVOS } from '../adaptadores/adaptadores.module';
import { ArchivoNoEncontrado, type PuertoArchivos } from '../adaptadores/archivos/puerto';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { scopeDeAgente, type EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { claveBinario, REGEX_VERSION_AGENTE } from '../scope/versiones-agente';
import type {
  ActualizacionAutomaticaHechaDto,
  ReporteActualizacionDto,
  VersionAgenteDto,
  VersionCanalDto,
} from './dto/actualizacion.dto';

/**
 * Tope del binario publicado (F2-143). El agente self-contained de un solo archivo pesa ~70 MB;
 * 128 MB deja holgura sin dejar que una subida cualquiera se coma la memoria del api (el cuerpo
 * se recibe entero en un Buffer: ver `docs/actualizacion-agente.md`, "Límites"). El agente aplica
 * el MISMO tope a la descarga.
 */
export const TAMANO_MAXIMO_BINARIO = 128 * 1024 * 1024;

/** Vigencia del enlace firmado de descarga que recibe el agente. */
export const TTL_ENLACE_BINARIO_S = 15 * 60;

/** Lo que el controlador necesita para servir la descarga, en streaming. */
export interface BinarioParaDescarga {
  flujo: Readable;
  bytes: number;
  nombre: string;
}

/**
 * Auto-update del agente (F2-143): el canal de versiones, la bandera de rollout por sucursal y los
 * reportes del agente. El canal es de PLATAFORMA (`scope/versiones-agente.ts`); la bandera y los
 * reportes, de cada sucursal (con scope). Nada de esto toca SoftRestaurant.
 */
@Injectable()
export class ActualizacionAgenteService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_ARCHIVOS) private readonly archivos: PuertoArchivos,
  ) {}

  // ------------------------------------------------------------------ agente

  /**
   * `GET /agente/version`. La bandera se lee con el scope del agente (su empresa) y por SU
   * sucursal: la API key no puede preguntar por otra. El api NO compara versiones: compara el
   * agente, por igualdad, así retirar la vigente también sirve para bajar de versión.
   */
  async canal(agente: AgenteAutenticado): Promise<VersionCanalDto> {
    const sucursal = await this.datos.para(scopeDeAgente(agente)).sucursal.findFirst({
      where: { id: agente.sucursalId },
      select: { actualizacionAutomatica: true },
    });
    if (!sucursal?.actualizacionAutomatica) return { disponible: false };
    const vigente = await this.datos.versionesAgente().vigente();
    if (!vigente) return { disponible: false };

    // La firma sale del adaptador (el secreto no sale de él); aquí sólo se toman sus parámetros
    // y se arma el enlace relativo a la URL base del api, que es contra la que resuelve el agente.
    const firmada = new URL(
      await this.archivos.urlFirmada(vigente.claveArchivo, TTL_ENLACE_BINARIO_S),
      'http://base.invalid',
    );
    const query = new URLSearchParams({
      expira: firmada.searchParams.get('expira') ?? '',
      firma: firmada.searchParams.get('firma') ?? '',
    });
    return {
      disponible: true,
      version: vigente.version,
      sha256: vigente.sha256,
      tamanoBytes: vigente.tamanoBytes,
      url: `agente/binario/${vigente.version}?${query.toString()}`,
    };
  }

  /** `POST /agente/actualizacion`: clavado a la sucursal de la API key. */
  async reportar(agente: AgenteAutenticado, dto: ReporteActualizacionDto): Promise<void> {
    const motivo = dto.motivo ?? null;
    if (dto.resultado === 'fallida' && motivo === null) {
      throw new BadRequestException('Con resultado fallida, `motivo` es obligatorio.');
    }
    if (dto.resultado === 'aplicada' && motivo !== null) {
      throw new BadRequestException('Con resultado aplicada no va `motivo`.');
    }
    const detalle = dto.detalle?.trim() ? dto.detalle.trim() : null;
    await this.datos
      .deSucursal(agente)
      .enTransaccion((ops) =>
        ops.reportarActualizacion(
          { resultado: dto.resultado, version: dto.version, motivo, detalle },
          new Date(this.reloj.ahora()),
        ),
      );
  }

  /**
   * `GET /agente/binario/:version`: pública, la firma es la credencial. Firma alterada o vencida,
   * versión inválida, retirada, inexistente o sin archivo: el MISMO 404.
   */
  async binario(version: string, expira: number, firma: string): Promise<BinarioParaDescarga> {
    const noEncontrado = () => new NotFoundException('Recurso no encontrado');
    const publicada = await this.datos.versionesAgente().publicada(version);
    if (!publicada || !this.archivos.verificarUrl(publicada.claveArchivo, expira, firma)) {
      throw noEncontrado();
    }
    try {
      const { flujo, bytes } = await this.archivos.abrirLectura(publicada.claveArchivo);
      return { flujo, bytes, nombre: `agente-${publicada.version}.exe` };
    } catch (error) {
      if (error instanceof ArchivoNoEncontrado) throw noEncontrado();
      throw error;
    }
  }

  // ------------------------------------------------------------ admin_global

  async listar(scope: EmpresaScope): Promise<VersionAgenteDto[]> {
    const [filas, vigente] = await Promise.all([
      this.datos.escrituraVersionesAgente(scope).listar(),
      this.datos.versionesAgente().vigente(),
    ]);
    return filas.map((v) => ({
      version: v.version,
      sha256: v.sha256,
      tamanoBytes: v.tamanoBytes,
      notas: v.notas,
      publicadaAt: v.publicadaAt.toISOString(),
      retiradaAt: v.retiradaAt?.toISOString() ?? null,
      vigente: v.version === vigente?.version,
    }));
  }

  /**
   * Publica un binario: el SHA-256 y el tamaño los calcula el SERVIDOR sobre lo recibido (no se le
   * cree a nadie). Primero se guarda el archivo y después la fila: si la fila truena, queda un
   * archivo huérfano que nadie sirve; al revés, quedaría una versión vigente sin binario.
   */
  async publicar(
    scope: EmpresaScope,
    actor: Actor,
    version: string,
    notas: string | undefined,
    cuerpo: unknown,
  ): Promise<VersionAgenteDto> {
    if (!REGEX_VERSION_AGENTE.test(version)) {
      throw new BadRequestException('La versión tiene que ser X.Y.Z.');
    }
    if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
      throw new BadRequestException(
        'El cuerpo tiene que ser el binario del agente, con Content-Type application/octet-stream.',
      );
    }
    if (cuerpo.length > TAMANO_MAXIMO_BINARIO) {
      throw new PayloadTooLargeException('El binario pasa del tope de 128 MB.');
    }
    const escritura = this.datos.escrituraVersionesAgente(scope);
    if (await escritura.existe(version)) {
      throw new ConflictException(`La versión ${version} ya está publicada.`);
    }
    const clave = claveBinario(version);
    await this.archivos.guardar(clave, cuerpo, 'application/octet-stream');
    const fila = await escritura.publicar({
      version,
      sha256: createHash('sha256').update(cuerpo).digest('hex'),
      tamanoBytes: cuerpo.length,
      claveArchivo: clave,
      notas: notas?.trim() || null,
      publicadaPor: actor.id,
      publicadaAt: new Date(this.reloj.ahora()),
    });
    this.auditoria.registrar(actor, {
      accion: 'agente.version_publicada',
      recurso: 'version_agente',
      recursoId: fila.id,
      empresaId: null,
    });
    return (await this.listar(scope)).find((v) => v.version === version)!;
  }

  async retirar(scope: EmpresaScope, actor: Actor, version: string): Promise<VersionAgenteDto> {
    const fila = await this.datos
      .escrituraVersionesAgente(scope)
      .retirar(version, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'agente.version_retirada',
      recurso: 'version_agente',
      recursoId: fila.id,
      empresaId: null,
    });
    return (await this.listar(scope)).find((v) => v.version === fila.version)!;
  }

  /** La bandera de rollout de una sucursal. Fuera del alcance (o inexistente) = 404. */
  async cambiarAutomatica(
    scope: EmpresaScope,
    actor: Actor,
    sucursalId: string,
    activa: boolean,
  ): Promise<ActualizacionAutomaticaHechaDto> {
    const datos = this.datos.para(scope);
    const sucursal = await datos.sucursal.findFirst({
      where: { id: sucursalId },
      select: { id: true, empresaId: true },
    });
    if (!sucursal) throw new NotFoundException('Recurso no encontrado');
    await datos.sucursal.updateMany({
      where: { id: sucursal.id },
      data: { actualizacionAutomatica: activa },
    });
    this.auditoria.registrar(actor, {
      accion: 'sucursal.actualizacion_automatica',
      recurso: 'sucursal',
      recursoId: sucursal.id,
      empresaId: sucursal.empresaId,
      campos: ['actualizacionAutomatica'],
    });
    return { sucursalId: sucursal.id, actualizacionAutomatica: activa };
  }
}
