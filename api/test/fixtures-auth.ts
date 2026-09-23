import { hash } from '@node-rs/argon2';
import { RolUsuario, type PrismaClient } from '@prisma/client';

import { ARGON2_OPCIONES } from '../src/auth/argon2';

/**
 * Fixtures SINTÉTICAS de los tests de auth y scope (F1-011). No dependen del
 * seed: en CI sólo corre `migrate deploy` y la base llega vacía. UUIDs fijos y
 * un dominio de email propio, para poder limpiarlas sin tocar nada más.
 *
 * Tres empresas: A y B activas (el cruce que prueba el 404) y C inactiva.
 */
export const FX = {
  empresaA: 'f1011000-0000-4000-8000-00000000000a',
  empresaB: 'f1011000-0000-4000-8000-00000000000b',
  empresaC: 'f1011000-0000-4000-8000-00000000000c',
  sucursalA1: 'f1011000-0000-4000-8000-0000000000a1',
  sucursalA2: 'f1011000-0000-4000-8000-0000000000a2',
  sucursalB1: 'f1011000-0000-4000-8000-0000000000b1',
  /** Un UUID válido que no es de nadie. */
  inexistente: 'f1011000-0000-4000-8000-0000000000ff',
} as const;

export const DOMINIO = '@f1-011.test';
export const PASSWORD = 'contrasena-sintetica-F1-011';

export const USUARIOS = {
  visorA: {
    id: 'f1011000-0000-4000-8000-000000000101',
    email: `visor.a${DOMINIO}`,
    rol: RolUsuario.visor,
    empresaId: FX.empresaA,
    activo: true,
  },
  visorB: {
    id: 'f1011000-0000-4000-8000-000000000102',
    email: `visor.b${DOMINIO}`,
    rol: RolUsuario.visor,
    empresaId: FX.empresaB,
    activo: true,
  },
  adminEmpresaA: {
    id: 'f1011000-0000-4000-8000-000000000103',
    email: `admin.a${DOMINIO}`,
    rol: RolUsuario.admin_empresa,
    empresaId: FX.empresaA,
    activo: true,
  },
  adminGlobal: {
    id: 'f1011000-0000-4000-8000-000000000104',
    email: `admin.global${DOMINIO}`,
    rol: RolUsuario.admin_global,
    empresaId: null,
    activo: true,
  },
  visorInactivo: {
    id: 'f1011000-0000-4000-8000-000000000105',
    email: `visor.inactivo${DOMINIO}`,
    rol: RolUsuario.visor,
    empresaId: FX.empresaA,
    activo: false,
  },
  visorEmpresaInactiva: {
    id: 'f1011000-0000-4000-8000-000000000106',
    email: `visor.c${DOMINIO}`,
    rol: RolUsuario.visor,
    empresaId: FX.empresaC,
    activo: true,
  },
} as const;

export async function limpiarFixtures(prisma: PrismaClient): Promise<void> {
  const empresas = [FX.empresaA, FX.empresaB, FX.empresaC];
  // Reportes programados (F2-141): cuelgan del usuario y de la empresa, así que van antes
  // que los dos. Envíos primero (FK a la suscripción).
  const suscripciones = {
    where: {
      OR: [{ empresaId: { in: empresas } }, { usuario: { email: { endsWith: DOMINIO } } }],
    },
  };
  await prisma.envioReporte.deleteMany({ where: { suscripcion: suscripciones.where } });
  await prisma.suscripcionReporte.deleteMany(suscripciones);
  await prisma.usuario.deleteMany({ where: { email: { endsWith: DOMINIO } } });
  // Ventas de prueba (F1-030) colgadas de estas sucursales: las FK son Restrict,
  // así que se borran de las hojas hacia arriba antes que las sucursales.
  const deEstas = { where: { empresaId: { in: empresas } } };
  await prisma.chequePartida.deleteMany(deEstas);
  await prisma.chequePago.deleteMany(deEstas);
  await prisma.cheque.deleteMany(deEstas);
  await prisma.mesaSnapshot.deleteMany(deEstas);
  // El estado del agente (F1-031: lo escribe el heartbeat de la ingesta).
  await prisma.agenteEstado.deleteMany(deEstas);
  // El último contacto del agente (F1-061: lo escribe todo lote aceptado).
  await prisma.agenteContacto.deleteMany(deEstas);
  // El catálogo de formas de pago (F1-032) cuelga de la empresa.
  await prisma.formaPagoCatalogo.deleteMany(deEstas);
  // El centro de alertas (F2-224) cuelga de la empresa y de la sucursal.
  await prisma.alerta.deleteMany(deEstas);
  await prisma.reglaAlerta.deleteMany(deEstas);
  await prisma.alertaEvaluacion.deleteMany(deEstas);
  // La bandeja del correo falso (F2-202) guarda la empresa de cada correo (F2-141 manda).
  await prisma.correoEnviado.deleteMany(deEstas);
  // Catálogos espejo (F2-230): la metadata cuelga del producto; lo demás, de la sucursal.
  await prisma.productoMetadata.deleteMany(deEstas);
  // El mapeo área → canal (F2-233) cuelga del área espejo.
  await prisma.areaCanal.deleteMany(deEstas);
  await prisma.grupoProducto.deleteMany(deEstas);
  await prisma.producto.deleteMany(deEstas);
  await prisma.meseroCatalogo.deleteMany(deEstas);
  await prisma.clienteCatalogo.deleteMany(deEstas);
  await prisma.areaCatalogo.deleteMany(deEstas);
  await prisma.canalVentaCatalogo.deleteMany(deEstas);
  // Catálogos de inventario (F2-120), de la sucursal.
  await prisma.unidadCatalogo.deleteMany(deEstas);
  await prisma.grupoInsumo.deleteMany(deEstas);
  await prisma.insumo.deleteMany(deEstas);
  await prisma.almacenCatalogo.deleteMany(deEstas);
  await prisma.proveedorCatalogo.deleteMany(deEstas);
  // Existencias (F2-121), de la sucursal.
  await prisma.existencia.deleteMany(deEstas);
  await prisma.lecturaExistencias.deleteMany(deEstas);
  await prisma.limiteExistencia.deleteMany(deEstas);
  // Compras (F2-126): las partidas cuelgan de la compra. Gastos antes que sus categorías.
  await prisma.partidaCompra.deleteMany(deEstas);
  await prisma.compra.deleteMany(deEstas);
  await prisma.gasto.deleteMany(deEstas);
  await prisma.categoriaGasto.deleteMany(deEstas);
  // Traspasos (F2-124) ANTES de las pólizas: sus espejos las apuntan con ON DELETE RESTRICT.
  await prisma.partidaTraspaso.deleteMany(deEstas);
  await prisma.traspaso.deleteMany(deEstas);
  // Pólizas y movimientos (F2-122): las partidas cuelgan de la póliza.
  await prisma.movimientoInventario.deleteMany(deEstas);
  await prisma.polizaInventario.deleteMany(deEstas);
  // Conteos físicos (F2-123): los renglones cuelgan del conteo.
  await prisma.renglonReceta.deleteMany(deEstas);
  await prisma.receta.deleteMany(deEstas);
  await prisma.partidaConteo.deleteMany(deEstas);
  await prisma.conteoFisico.deleteMany(deEstas);
  await prisma.sincronizacionCatalogo.deleteMany(deEstas);
  await prisma.solicitudSincronizacion.deleteMany(deEstas);
  // Datos fiscales y receptores frecuentes (F2-100), de la empresa.
  await prisma.perfilFiscal.deleteMany(deEstas);
  await prisma.receptorFrecuente.deleteMany(deEstas);
  await prisma.sucursal.deleteMany({ where: { empresaId: { in: empresas } } });
  await prisma.empresa.deleteMany({ where: { id: { in: empresas } } });
}

export async function crearFixtures(prisma: PrismaClient): Promise<void> {
  // Por si una corrida anterior murió a medias.
  await limpiarFixtures(prisma);

  await prisma.empresa.createMany({
    data: [
      { id: FX.empresaA, nombre: 'Empresa Prueba A (F1-011)', activo: true },
      { id: FX.empresaB, nombre: 'Empresa Prueba B (F1-011)', activo: true },
      { id: FX.empresaC, nombre: 'Empresa Prueba C inactiva (F1-011)', activo: false },
    ],
  });
  await prisma.sucursal.createMany({
    data: [
      { id: FX.sucursalA1, empresaId: FX.empresaA, nombre: 'A1' },
      { id: FX.sucursalA2, empresaId: FX.empresaA, nombre: 'A2' },
      { id: FX.sucursalB1, empresaId: FX.empresaB, nombre: 'B1' },
    ],
  });
  const passwordHash = await hash(PASSWORD, ARGON2_OPCIONES);
  await prisma.usuario.createMany({
    data: Object.entries(USUARIOS).map(([clave, u]) => ({
      ...u,
      nombre: `Prueba ${clave}`,
      passwordHash,
    })),
  });
}
