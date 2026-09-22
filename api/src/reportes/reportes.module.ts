import { Module } from '@nestjs/common';

import { leerAuthConfig } from '../config/auth.config';
import { VentasModule } from '../ventas/ventas.module';
import { REPORTES_CONFIG, leerReportesConfig } from './config';
import { BajaReportesController, CuentaReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { ReportesProgramador } from './programador';

/** Reportes programados por correo (F2-141): suscripción propia, programador y baja pública. */
@Module({
  imports: [VentasModule],
  controllers: [CuentaReportesController, BajaReportesController],
  providers: [
    // Se lee al crear la app: sin PANEL_URL en producción, el arranque truena aquí.
    {
      provide: REPORTES_CONFIG,
      useFactory: () => leerReportesConfig(process.env, leerAuthConfig().accessSecret),
    },
    ReportesService,
    ReportesProgramador,
  ],
  exports: [ReportesService, ReportesProgramador],
})
export class ReportesModule {}
