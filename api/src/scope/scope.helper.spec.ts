import { NotFoundException } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';

import { scopeDeUsuario, type EmpresaScope } from './empresa-scope';
import { encontradoOr404, LLAVE_EMPRESA, whereEmpresa, whereScoped } from './scope.helper';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const GLOBAL: EmpresaScope = { tipo: 'global' };
const EMPRESA_A: EmpresaScope = { tipo: 'empresa', empresaId: A };

describe('scopeDeUsuario', () => {
  it('admin_global ve todo', () => {
    expect(scopeDeUsuario({ rol: RolUsuario.admin_global, empresaId: null })).toEqual(GLOBAL);
  });

  it.each([RolUsuario.admin_empresa, RolUsuario.visor])('%s ve sólo su empresa', (rol) => {
    expect(scopeDeUsuario({ rol, empresaId: A })).toEqual(EMPRESA_A);
  });

  it.each([RolUsuario.admin_empresa, RolUsuario.visor])(
    '%s sin empresa se rechaza (nunca se degrada a "ve todo")',
    (rol) => {
      expect(() => scopeDeUsuario({ rol, empresaId: null })).toThrow();
    },
  );
});

describe('whereEmpresa / whereScoped', () => {
  it('conoce la llave de tenant de cada modelo (Empresa filtra por id)', () => {
    expect(LLAVE_EMPRESA).toEqual({
      Empresa: 'id',
      Sucursal: 'empresaId',
      Usuario: 'empresaId',
      AgenteEstado: 'empresaId',
      AgenteContacto: 'empresaId',
      Cheque: 'empresaId',
      ChequePartida: 'empresaId',
      ChequePago: 'empresaId',
      MesaSnapshot: 'empresaId',
      FormaPagoCatalogo: 'empresaId',
      SesionUsuario: 'empresaId',
      CorreoEnviado: 'empresaId',
      // F2-224: centro de alertas.
      Alerta: 'empresaId',
      ReglaAlerta: 'empresaId',
      AlertaEvaluacion: 'empresaId',
      // F2-141: reportes programados.
      SuscripcionReporte: 'empresaId',
      EnvioReporte: 'empresaId',
      // F2-230: catálogos espejo.
      GrupoProducto: 'empresaId',
      Producto: 'empresaId',
      MeseroCatalogo: 'empresaId',
      ClienteCatalogo: 'empresaId',
      AreaCatalogo: 'empresaId',
      CanalVentaCatalogo: 'empresaId',
      ProductoMetadata: 'empresaId',
      // F2-233: el mapeo área → canal.
      AreaCanal: 'empresaId',
      SincronizacionCatalogo: 'empresaId',
      SolicitudSincronizacion: 'empresaId',
      // F2-120: catálogos de inventario.
      UnidadCatalogo: 'empresaId',
      GrupoInsumo: 'empresaId',
      Insumo: 'empresaId',
      AlmacenCatalogo: 'empresaId',
      ProveedorCatalogo: 'empresaId',
      // F2-121: existencias, su lectura y los límites propios.
      Existencia: 'empresaId',
      LecturaExistencias: 'empresaId',
      LimiteExistencia: 'empresaId',
      PolizaInventario: 'empresaId',
      MovimientoInventario: 'empresaId',
      // F2-123: conteos físicos y sus renglones (dato propio).
      ConteoFisico: 'empresaId',
      PartidaConteo: 'empresaId',
      // F2-124: traspasos del panel y sus renglones (dato propio).
      Traspaso: 'empresaId',
      PartidaTraspaso: 'empresaId',
      // F2-125: recetas leídas de SR y sus renglones.
      Receta: 'empresaId',
      RenglonReceta: 'empresaId',
      // F2-126: compras leídas de SR, sus partidas, y categorías y gastos (dato propio).
      Compra: 'empresaId',
      PartidaCompra: 'empresaId',
      CategoriaGasto: 'empresaId',
      Gasto: 'empresaId',
      // F2-100: datos fiscales y receptores frecuentes (dato propio).
      PerfilFiscal: 'empresaId',
      ReceptorFrecuente: 'empresaId',
    });
    expect(whereEmpresa(EMPRESA_A, 'Empresa')).toEqual({ id: A });
    expect(whereEmpresa(EMPRESA_A, 'Sucursal')).toEqual({ empresaId: A });
  });

  it('para admin_global no agrega filtro', () => {
    expect(whereEmpresa(GLOBAL, 'Sucursal')).toEqual({});
    expect(whereScoped(GLOBAL, 'Sucursal')).toEqual({});
    expect(whereScoped(GLOBAL, 'Sucursal', { nombre: 'x' })).toEqual({ nombre: 'x' });
  });

  it('para una empresa hace AND con el where del caller, sin reemplazarlo', () => {
    expect(whereScoped(EMPRESA_A, 'Sucursal')).toEqual({ empresaId: A });
    // Aunque el caller pida otra empresa, el AND deja el resultado vacío en vez
    // de dejarle ganar.
    expect(whereScoped(EMPRESA_A, 'Sucursal', { empresaId: 'otra' })).toEqual({
      AND: [{ empresaId: 'otra' }, { empresaId: A }],
    });
  });
});

describe('encontradoOr404', () => {
  it('devuelve la fila si existe', () => {
    const fila = { id: 1 };
    expect(encontradoOr404(fila)).toBe(fila);
  });

  it('null y undefined son 404 (NotFound, nunca Forbidden), con el mismo cuerpo', () => {
    const errores = [null, undefined].map((v) => {
      try {
        encontradoOr404(v);
      } catch (e) {
        return e;
      }
      throw new Error('no lanzó');
    });
    for (const e of errores) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
    const [a, b] = errores as NotFoundException[];
    expect(a.getResponse()).toEqual(b.getResponse());
  });
});
