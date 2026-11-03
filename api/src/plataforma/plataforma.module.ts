import { Module } from '@nestjs/common';

import { MembresiaController } from './membresia.controller';
import { PlataformaController } from './plataforma.controller';
import { PlataformaService } from './plataforma.service';
import { SoloPlataformaGuard } from './solo-plataforma.guard';

/**
 * El panel de plataforma (membresías, ver `docs/plataforma.md`): planes, clientes, pagos,
 * administradores internos, bitácora y ajustes globales, sólo para admin_global; y la membresía
 * propia (`/cuenta/membresia`) para el aviso de pago pendiente.
 */
@Module({
  controllers: [PlataformaController, MembresiaController],
  providers: [PlataformaService, SoloPlataformaGuard],
})
export class PlataformaModule {}
