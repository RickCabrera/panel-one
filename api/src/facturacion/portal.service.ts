import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import {
  ScopedPrismaService,
  type LecturaCodigoPortal,
  type LecturaPortalPublico,
} from '../scope/scoped-prisma.service';
import {
  esCodigoValido,
  estadoPublico,
  MENSAJE_ESTADO,
  normalizarCodigo,
  type EstadoPublico,
} from './codigo';
import { MENSAJE_CODIGO_FORMATO, MENSAJE_CODIGO_NO_ENCONTRADO } from './codigos.service';
import type {
  ConsultaCodigoPortalDto,
  DesgloseTicketDto,
  GuardarPortalDto,
  PortalPublicoDto,
  SolicitarFacturaDto,
  SucursalPortalDto,
} from './dto/portal.dto';
import { EMISION_PORTAL, type EmisionPortal, type FacturaPortal } from './emision-portal';
import {
  esSlugValido,
  MAX_BYTES_LOGO,
  MENSAJE_SLUG,
  normalizarColor,
  tipoDeLogo,
  validarReceptor,
  type ReceptorPortal,
} from './portal';
import { normalizarRfc } from './sat';

export const MENSAJE_PORTAL_NO_ENCONTRADO = 'Portal de facturación no encontrado.';

/**
 * El portal público de autofactura (F2-103) y su configuración por sucursal.
 *
 * Lo público corre SIN sesión y sin tenant: el slug es una URL pública y el código es la
 * credencial del ticket. Por eso todo pasa por los métodos del helper con lista blanca
 * (`portalPublico`, `logoPortal`, `codigoFacturacionDelPortal`), y la empresa del portal sólo se
 * usa para acotar el código a esa empresa (dentro del helper, en el WHERE).
 */
@Injectable()
export class PortalFacturacionService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(EMISION_PORTAL) private readonly emision: EmisionPortal,
  ) {}

  /** El portal visible, o 404 (mismo cuerpo para inexistente, inactivo o dado de baja). */
  async #portal(slug: string): Promise<LecturaPortalPublico> {
    const portal = esSlugValido(slug) ? await this.datos.portalPublico(slug) : null;
    if (!portal) throw new NotFoundException(MENSAJE_PORTAL_NO_ENCONTRADO);
    return portal;
  }

  async portal(slug: string): Promise<PortalPublicoDto> {
    const p = await this.#portal(slug);
    return {
      slug: p.slug,
      sucursal: p.sucursal,
      color: p.color,
      logoUrl: p.tieneLogo ? `/facturacion/portal/${p.slug}/logo` : null,
      emisionDisponible: await this.emision.disponible(p.empresaId),
    };
  }

  async logo(slug: string): Promise<{ logo: Buffer; tipo: string }> {
    const logo = esSlugValido(slug) ? await this.datos.logoPortal(slug) : null;
    if (!logo) throw new NotFoundException(MENSAJE_PORTAL_NO_ENCONTRADO);
    return logo;
  }

  /**
   * El código visto desde el portal: 404 del portal → 400 de formato (sin tocar la base) → 404 del
   * código (no existe, es de OTRA empresa, o su sucursal o empresa están dadas de baja: mismo
   * cuerpo). Ojo: esto NO esconde la existencia de un código (la consulta global de F2-101 ya la
   * confirma a cualquiera); sólo evita que el portal de una empresa muestre tickets de otra.
   */
  async #codigo(
    slug: string,
    texto: string,
  ): Promise<{ portal: LecturaPortalPublico; fila: LecturaCodigoPortal; estado: EstadoPublico }> {
    const portal = await this.#portal(slug);
    const codigo = normalizarCodigo(texto);
    if (!esCodigoValido(codigo)) throw new BadRequestException([MENSAJE_CODIGO_FORMATO]);
    const fila = await this.datos.codigoFacturacionDelPortal(codigo, portal.empresaId);
    if (!fila || !fila.sucursal.activo || !fila.sucursal.empresa.activo) {
      throw new NotFoundException(MENSAJE_CODIGO_NO_ENCONTRADO);
    }
    return { portal, fila, estado: estadoPublico(fila, fila.cheque, this.reloj.ahora()) };
  }

  async consultarCodigo(slug: string, texto: string): Promise<ConsultaCodigoPortalDto> {
    const { fila, estado } = await this.#codigo(slug, texto);
    return {
      codigo: fila.codigo,
      estado,
      mensaje: MENSAJE_ESTADO[estado],
      ticket:
        estado === 'pendiente'
          ? {
              sucursal: fila.sucursal.nombre,
              fecha: (fila.cheque.cerradoAt ?? fila.cheque.abiertoAt).toISOString(),
              zonaHoraria: fila.sucursal.zonaHoraria,
              total: fila.cheque.total.toFixed(2),
              expiraAt: fila.expiraAt.toISOString(),
              desglose: desgloseDe(fila.cheque),
            }
          : null,
    };
  }

  /**
   * Pide la factura de un código. Orden fijo: portal (404) → formato del código (400) → código de
   * la empresa (404) → estado (409 con `estado`) → datos del receptor (400 con `campos`) → puerto
   * de emisión. Nada de esto escribe: lo que se guarde (CFDI, receptor frecuente, estado del
   * código) es de la emisión (F2-104). Hoy el puerto responde 503.
   */
  async solicitarFactura(slug: string, dto: SolicitarFacturaDto): Promise<FacturaPortal> {
    const { portal, fila, estado } = await this.#codigo(slug, dto.codigo);
    if (estado !== 'pendiente') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: MENSAJE_ESTADO[estado],
        estado,
      });
    }
    const receptor: ReceptorPortal = {
      ...dto.receptor,
      rfc: normalizarRfc(dto.receptor.rfc),
      razonSocial: dto.receptor.razonSocial.trim(),
      email: dto.receptor.email.trim(),
    };
    const campos = validarReceptor(receptor);
    if (Object.keys(campos).length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: Object.values(campos),
        campos,
      });
    }
    return this.emision.emitir({
      codigoId: fila.id,
      codigo: fila.codigo,
      chequeId: fila.chequeId,
      sucursalId: fila.sucursalId,
      empresaId: portal.empresaId,
      receptor,
    });
  }

  // -------------------------------------------------------------------------
  // Administración (sólo admins; el rol lo pone el controlador)
  // -------------------------------------------------------------------------

  async portales(scope: EmpresaScope, empresaId: string): Promise<SucursalPortalDto[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId },
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        activo: true,
        portalFacturacion: {
          select: { slug: true, color: true, activo: true, logoTipo: true, updatedAt: true },
        },
      },
    });
    return sucursales.map((s) => ({
      sucursalId: s.id,
      sucursal: s.nombre,
      sucursalActiva: s.activo,
      portal: s.portalFacturacion
        ? {
            slug: s.portalFacturacion.slug,
            color: s.portalFacturacion.color,
            activo: s.portalFacturacion.activo,
            tieneLogo: s.portalFacturacion.logoTipo !== null,
            actualizadoAt: s.portalFacturacion.updatedAt.toISOString(),
          }
        : null,
    }));
  }

  /** Alcance de la sucursal (404) ANTES que el formato (400) y el slug ocupado (409). */
  async guardarPortal(
    scope: EmpresaScope,
    actor: Actor,
    sucursalId: string,
    dto: GuardarPortalDto,
  ): Promise<SucursalPortalDto> {
    const empresaId = await this.#empresaDeSucursal(scope, sucursalId);
    const errores: string[] = [];
    if (!esSlugValido(dto.slug)) errores.push(MENSAJE_SLUG);
    const color = normalizarColor(dto.color);
    if (color === null) errores.push('El color va como #rrggbb (p. ej. #0f766e).');
    if (errores.length > 0) throw new BadRequestException(errores);
    const { creado } = await this.datos
      .facturacion(scope)
      .guardarPortal(
        sucursalId,
        { slug: dto.slug, color: color!, activo: dto.activo },
        actor.id,
        new Date(this.reloj.ahora()),
      );
    this.auditoria.registrar(actor, {
      accion: creado ? 'portal_facturacion.crear' : 'portal_facturacion.editar',
      recurso: 'portal_facturacion',
      recursoId: sucursalId,
      empresaId,
      campos: ['slug', 'color', 'activo'],
    });
    return this.#unPortal(scope, empresaId, sucursalId);
  }

  /** Alcance (404) → base64/tamaño/tipo (400) → hay portal (409). `null` quita el logo. */
  async guardarLogo(
    scope: EmpresaScope,
    actor: Actor,
    sucursalId: string,
    base64: string | null,
  ): Promise<SucursalPortalDto> {
    const empresaId = await this.#empresaDeSucursal(scope, sucursalId);
    let logo: { bytes: Buffer; tipo: string } | null = null;
    if (base64 !== null) {
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length === 0) throw new BadRequestException(['El logo está vacío.']);
      if (bytes.length > MAX_BYTES_LOGO) {
        throw new BadRequestException([`El logo pesa más de ${MAX_BYTES_LOGO / 1024} KB.`]);
      }
      const tipo = tipoDeLogo(bytes);
      if (tipo === null) {
        throw new BadRequestException(['El logo tiene que ser PNG, JPEG o WebP (SVG no).']);
      }
      logo = { bytes, tipo };
    }
    await this.datos
      .facturacion(scope)
      .guardarLogoPortal(sucursalId, logo, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: logo ? 'portal_facturacion.logo' : 'portal_facturacion.quitar_logo',
      recurso: 'portal_facturacion',
      recursoId: sucursalId,
      empresaId,
      campos: ['logo'],
    });
    return this.#unPortal(scope, empresaId, sucursalId);
  }

  async #empresaDeSucursal(scope: EmpresaScope, sucursalId: string): Promise<string> {
    const s = encontradoOr404(
      await this.datos.para(scope).sucursal.findFirst({
        where: { id: sucursalId },
        select: { empresaId: true },
      }),
    );
    return s.empresaId;
  }

  async #unPortal(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId: string,
  ): Promise<SucursalPortalDto> {
    const todas = await this.portales(scope, empresaId);
    return encontradoOr404(todas.find((s) => s.sucursalId === sucursalId) ?? null);
  }
}

/**
 * Subtotal e impuestos del ticket, SÓLO si suman exactamente su total.
 * DECISION PROVISIONAL (nocturno): no se sabe qué incluye `subtotal` en SR (antes o después del
 * descuento) ni si el `total` lleva la propina (docs/esquema-sr.md §2). Un desglose que no cuadra
 * con el total que se muestra al lado confunde al cliente justo antes de facturar, así que en ese
 * caso sólo se muestra el total. El desglose del CFDI lo calcula F2-104, no esto.
 */
export function desgloseDe(cheque: {
  subtotal: Prisma.Decimal;
  impuestos: Prisma.Decimal;
  total: Prisma.Decimal;
}): DesgloseTicketDto | null {
  if (!cheque.subtotal.plus(cheque.impuestos).equals(cheque.total)) return null;
  return { subtotal: cheque.subtotal.toFixed(2), impuestos: cheque.impuestos.toFixed(2) };
}
