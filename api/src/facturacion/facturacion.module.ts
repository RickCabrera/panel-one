import { Module } from '@nestjs/common';

import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';

/**
 * Facturación (Epic 8). F2-100: datos fiscales de la empresa y carga del CSD contra
 * `PUERTO_TIMBRADO` (global, de `AdaptadoresModule`). Los receptores frecuentes nacen aquí y los
 * lee la ficha de Clientes (`CatalogosService`).
 */
@Module({
  controllers: [FacturacionController],
  providers: [FacturacionService],
})
export class FacturacionModule {}
