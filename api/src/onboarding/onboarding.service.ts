import { hash } from '@node-rs/argon2';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma, RolUsuario } from '@prisma/client';

import { generarApiKey, hashApiKey } from '../agentes/api-key';
import { ARGON2_OPCIONES } from '../auth/argon2';
import { Auditoria, type Actor } from '../comun/auditoria';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { EmpresaCreada, SucursalCreada, UsuarioCreado } from '../scope/escritura-admin';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { calcularArranque } from './arranque';
import type { AltaGuiadaDto, ArranqueDto } from './dto/onboarding.dto';
import { ONBOARDING_CONFIG, type OnboardingConfig } from './onboarding.config';

export interface AltaGuiadaHecha {
  empresa: EmpresaCreada;
  sucursales: (SucursalCreada & { apiKey: string })[];
  administrador: UsuarioCreado | null;
}

/** Nombre normalizado para detectar sucursales repetidas: sin mayúsculas ni espacios de más. */
function normalizar(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
}

/** El P2002 del email del usuario (el único único que el alta puede violar por datos del caller). */
function emailDuplicado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const objetivo = (error.meta as { target?: unknown } | undefined)?.target;
  const campos = Array.isArray(objetivo) ? objetivo.map(String) : [String(objetivo ?? '')];
  return campos.some((c) => c.includes('email'));
}

/**
 * Onboarding (F2-147): el alta guiada de una empresa y su checklist de arranque. Todo por el
 * helper de scope: el alta por `altaEnTransaccion(scope)`, las lecturas por `para(scope)`.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly auditoria: Auditoria,
    @Inject(ONBOARDING_CONFIG) private readonly config: OnboardingConfig,
  ) {}

  /**
   * Empresa + sucursales con su key + (opcional) su primer admin_empresa, en UNA transacción.
   * Las keys en claro sólo existen en esta respuesta; la base guarda su hash y la auditoría ni
   * eso.
   */
  async altaGuiada(
    actor: Actor,
    scope: EmpresaScope,
    dto: AltaGuiadaDto,
  ): Promise<AltaGuiadaHecha> {
    // La ruta ya exige admin_global; esto es la misma regla en el servicio (el helper, además,
    // truena con un scope de empresa).
    if (scope.tipo !== 'global') {
      throw new ForbiddenException('Sólo un administrador global da de alta empresas');
    }
    const vistos = new Set<string>();
    for (const s of dto.sucursales) {
      const clave = normalizar(s.nombre);
      if (vistos.has(clave)) {
        throw new BadRequestException(`La sucursal "${s.nombre.trim()}" viene repetida`);
      }
      vistos.add(clave);
    }

    // Lo caro (argon2) y lo aleatorio van FUERA de la transacción: no la alargan.
    const keys = dto.sucursales.map(() => generarApiKey());
    const passwordHash = dto.administrador
      ? await hash(dto.administrador.password, ARGON2_OPCIONES)
      : null;

    let hecha: AltaGuiadaHecha;
    try {
      hecha = await this.datos.altaEnTransaccion(scope, async (admin) => {
        const empresa = await admin.crearEmpresa(dto.nombre);
        const sucursales: AltaGuiadaHecha['sucursales'] = [];
        // En orden, una por una: el orden de la respuesta es el del formulario.
        for (const [i, s] of dto.sucursales.entries()) {
          const creada = await admin.crearSucursal(empresa.id, {
            nombre: s.nombre,
            zonaHoraria: s.zonaHoraria,
            apiKeyHash: hashApiKey(keys[i]),
          });
          sucursales.push({ ...creada, apiKey: keys[i] });
        }
        const administrador =
          dto.administrador && passwordHash
            ? await admin.crearUsuario(empresa.id, {
                email: dto.administrador.email,
                nombre: dto.administrador.nombre,
                rol: RolUsuario.admin_empresa,
                passwordHash,
              })
            : null;
        return { empresa, sucursales, administrador };
      });
    } catch (error) {
      if (emailDuplicado(error)) {
        throw new ConflictException('Ese email ya está en uso');
      }
      throw error;
    }

    // Auditoría (F1-060), igual que las altas sueltas. Sin keys, ni en claro ni su hash.
    const { empresa } = hecha;
    this.auditoria.registrar(actor, {
      accion: 'empresa.alta_guiada',
      recurso: 'empresa',
      recursoId: empresa.id,
      empresaId: empresa.id,
    });
    for (const s of hecha.sucursales) {
      this.auditoria.registrar(actor, {
        accion: 'sucursal.crear',
        recurso: 'sucursal',
        recursoId: s.id,
        empresaId: empresa.id,
      });
      this.auditoria.registrar(actor, {
        accion: 'sucursal.rotar_api_key',
        recurso: 'sucursal',
        recursoId: s.id,
        empresaId: empresa.id,
      });
    }
    if (hecha.administrador) {
      this.auditoria.registrar(actor, {
        accion: 'usuario.crear',
        recurso: 'usuario',
        recursoId: hecha.administrador.id,
        empresaId: empresa.id,
      });
    }
    return hecha;
  }

  /** El checklist de arranque de una empresa del alcance. Fuera de él = 404. */
  async arranque(scope: EmpresaScope, empresaId: string): Promise<ArranqueDto> {
    const datos = this.datos.para(scope);
    encontradoOr404(
      await datos.empresa.findFirst({ where: { id: empresaId }, select: { id: true } }),
    );

    const sucursales = await datos.sucursal.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true, apiKeyHash: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const ids = sucursales.map((s) => s.id);
    const [contactos, adminsEmpresa, conVentas] = await Promise.all([
      datos.agenteContacto.findMany({
        where: { empresaId, sucursalId: { in: ids } },
        select: { sucursalId: true },
      }),
      datos.usuario.count({
        where: { empresaId, rol: RolUsuario.admin_empresa, activo: true },
      }),
      // Una lectura por sucursal con el índice (sucursal, cierre): basta saber si hay UNA.
      Promise.all(
        ids.map(async (sucursalId) =>
          (await datos.cheque.findFirst({
            where: { empresaId, sucursalId },
            select: { id: true },
          }))
            ? sucursalId
            : null,
        ),
      ),
    ]);
    const reportaron = new Set(contactos.map((c) => c.sucursalId));
    const vendieron = new Set(conVentas.filter((id): id is string => id !== null));

    const { completo, pasos } = calcularArranque({
      sucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        // Sólo si EXISTE: el hash no sale de aquí.
        tieneKey: s.apiKeyHash !== null,
        agenteReporto: reportaron.has(s.id),
        tieneVentas: vendieron.has(s.id),
      })),
      adminsEmpresa,
    });
    return { empresaId, completo, pasos, descargaAgente: this.config.descargaAgente };
  }
}
