import { Module } from '@nestjs/common';

import { CodigoFacturacionPublicoController } from './codigos.controller';
import { CodigosFacturacionService } from './codigos.service';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { EMISION_PORTAL, EmisionNoDisponible } from './emision-portal';
import { PortalesAdminController, PortalPublicoController } from './portal.controller';
import { PortalFacturacionService } from './portal.service';

/**
 * Facturación (Epic 8). F2-100: datos fiscales de la empresa y carga del CSD contra
 * `PUERTO_TIMBRADO` (global, de `AdaptadoresModule`). Los receptores frecuentes nacen aquí y los
 * lee la ficha de Clientes (`CatalogosService`). F2-101: la consulta pública del código corto de
 * facturación y la regla de vigencia por empresa (los códigos los crea la ingesta). F2-103: el
 * portal público de autofactura y su configuración por sucursal; la emisión va por
 * `EMISION_PORTAL`, que en F2-103 es `EmisionNoDisponible` (503) y F2-104 cambia por la real.
 */
@Module({
  controllers: [
    FacturacionController,
    CodigoFacturacionPublicoController,
    PortalPublicoController,
    PortalesAdminController,
  ],
  providers: [
    FacturacionService,
    CodigosFacturacionService,
    PortalFacturacionService,
    { provide: EMISION_PORTAL, useClass: EmisionNoDisponible },
  ],
})
export class FacturacionModule {}
