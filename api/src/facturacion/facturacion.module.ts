import { Module } from '@nestjs/common';

import { CodigoFacturacionPublicoController } from './codigos.controller';
import { CodigosFacturacionService } from './codigos.service';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';

/**
 * Facturación (Epic 8). F2-100: datos fiscales de la empresa y carga del CSD contra
 * `PUERTO_TIMBRADO` (global, de `AdaptadoresModule`). Los receptores frecuentes nacen aquí y los
 * lee la ficha de Clientes (`CatalogosService`). F2-101: la consulta pública del código corto de
 * facturación y la regla de vigencia por empresa (los códigos los crea la ingesta).
 */
@Module({
  controllers: [FacturacionController, CodigoFacturacionPublicoController],
  providers: [FacturacionService, CodigosFacturacionService],
})
export class FacturacionModule {}
