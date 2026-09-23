import { Module } from '@nestjs/common';

import { CancelacionController } from './cancelacion.controller';
import { CancelacionProgramador } from './cancelacion.programador';
import { CancelacionCfdiService } from './cancelacion.service';
import { CodigoFacturacionPublicoController } from './codigos.controller';
import { CodigosFacturacionService } from './codigos.service';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { CfdiService, Espera } from './cfdi.service';
import { EmisionAdminController } from './emision-admin.controller';
import { EmisionAdminService } from './emision-admin.service';
import { EMISION_PORTAL } from './emision-portal';
import { ArchivosPublicosController, EntregaController } from './entrega.controller';
import { EntregaCfdiService } from './entrega.service';
import { FoliosController } from './folios.controller';
import { FoliosProgramador } from './folios.programador';
import { FoliosService } from './folios.service';
import { FacturaGlobalController } from './global.controller';
import { FacturaGlobalProgramador } from './global.programador';
import { FacturaGlobalService } from './global.service';
import { PortalesAdminController, PortalPublicoController } from './portal.controller';
import { PortalFacturacionService } from './portal.service';
import { TableroFacturacionController } from './tablero.controller';
import { TableroFacturacionService } from './tablero.service';
import { VentasModule } from '../ventas/ventas.module';

/**
 * Facturación (Epic 8). F2-100: datos fiscales de la empresa y carga del CSD contra
 * `PUERTO_TIMBRADO` (global, de `AdaptadoresModule`). Los receptores frecuentes nacen aquí y los
 * lee la ficha de Clientes (`CatalogosService`). F2-101: la consulta pública del código corto de
 * facturación y la regla de vigencia por empresa (los códigos los crea la ingesta). F2-103: el
 * portal público de autofactura y su configuración por sucursal; la emisión va por
 * `EMISION_PORTAL`. F2-104: la emisión del CFDI (`CfdiService`) es ese puerto. F2-105: la entrega
 * (`EntregaCfdiService`): archivos, correo con bitácora y reintento, y las descargas. F2-106: el
 * tablero (`TableroFacturacionService`), que lee la venta de `VentasModule`. F2-107: factura sin
 * ticket y refacturación (`EmisionAdminService`), sobre el mismo tramo de emisión. F2-108: la
 * factura global (`FacturaGlobalService`) y su programador de emisión automática. F2-109: la
 * cancelación de CFDI (`CancelacionCfdiService`), que también usa la refacturación, y su sondeo.
 * F2-110: el control de folios del PAC (`FoliosService`, saldo de PLATAFORMA) y sus avisos.
 */
@Module({
  imports: [VentasModule],
  controllers: [
    TableroFacturacionController,
    FacturacionController,
    CodigoFacturacionPublicoController,
    PortalPublicoController,
    PortalesAdminController,
    EntregaController,
    ArchivosPublicosController,
    EmisionAdminController,
    FacturaGlobalController,
    CancelacionController,
    FoliosController,
  ],
  providers: [
    FacturacionService,
    CodigosFacturacionService,
    PortalFacturacionService,
    CfdiService,
    EntregaCfdiService,
    TableroFacturacionService,
    EmisionAdminService,
    FacturaGlobalService,
    FacturaGlobalProgramador,
    CancelacionCfdiService,
    CancelacionProgramador,
    FoliosService,
    FoliosProgramador,
    Espera,
    { provide: EMISION_PORTAL, useExisting: CfdiService },
  ],
})
export class FacturacionModule {}
