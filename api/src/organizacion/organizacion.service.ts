import { Injectable } from '@nestjs/common';

import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

export interface EmpresaVista {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface SucursalVista {
  id: string;
  empresaId: string;
  nombre: string;
  zonaHoraria: string;
  activo: boolean;
}

/**
 * Empresas y sucursales en alcance (F1-033), para el selector del panel. Sólo
 * lectura; el CRUD es F1-060. `select` explícito: el hash de la API key de una
 * sucursal nunca sale de aquí.
 */
@Injectable()
export class OrganizacionService {
  constructor(private readonly datos: ScopedPrismaService) {}

  empresas(scope: EmpresaScope): Promise<EmpresaVista[]> {
    return this.datos.para(scope).empresa.findMany({
      select: { id: true, nombre: true, activo: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }

  async sucursales(scope: EmpresaScope, empresaId?: string): Promise<SucursalVista[]> {
    const datos = this.datos.para(scope);
    if (empresaId !== undefined) {
      await verificarAlcance(datos, empresaId);
    }
    return datos.sucursal.findMany({
      where: empresaId === undefined ? {} : { empresaId },
      select: { id: true, empresaId: true, nombre: true, zonaHoraria: true, activo: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }
}
