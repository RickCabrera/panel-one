import { ApiProperty } from '@nestjs/swagger';

import type { ResumenConciliacion } from '../conciliacion';

/** Contrato del resumen de una vuelta de conciliación con el PAC (F2-110b). Sólo conteos. */

class ReservasConciliadasDto {
  @ApiProperty({ description: 'Reservas colgadas en `timbrando` que esta vuelta revisó.' })
  revisadas!: number;

  @ApiProperty({
    description:
      'El PAC SÍ las timbró: quedaron vigentes (ticket facturado, tickets de la global en la global, ' +
      'el sustituto con el código) y se entregaron (archivos y correo).',
  })
  confirmadas!: number;

  @ApiProperty({
    description:
      'El PAC no las tiene en DOS búsquedas separadas al menos 15 min: se liberaron (el ticket se ' +
      'puede volver a facturar; la global suelta sus tickets). Su folio queda como hueco.',
  })
  liberadas!: number;

  @ApiProperty({
    description:
      'El PAC no las tiene en UNA búsqueda: esperan la segunda (una sola búsqueda vacía no libera).',
  })
  enEspera!: number;
}

class CancelacionesConciliadasDto {
  @ApiProperty({ description: 'Solicitudes `sin_confirmar` que se volvieron a consultar.' })
  revisadas!: number;

  @ApiProperty({
    description:
      'El PAC las registró tarde: la factura quedó cancelada (con sus efectos y el aviso al receptor).',
  })
  canceladas!: number;

  @ApiProperty({
    description:
      'Se descartaron: la factura ya estaba cancelada por otra solicitud, o el PAC la sigue viendo ' +
      'vigente pasados 7 días.',
  })
  descartadas!: number;
}

class SustitucionesConciliadasDto {
  @ApiProperty({ description: 'Refacturaciones con la cancelación 01 pendiente que se revisaron.' })
  revisadas!: number;

  @ApiProperty({ description: 'La factura anterior quedó cancelada con motivo 01.' })
  cerradas!: number;
}

class ArchivosConciliadosDto {
  @ApiProperty({ description: 'Facturas vigentes sin XML o PDF guardado que se revisaron.' })
  revisados!: number;

  @ApiProperty({ description: 'Facturas cuyos archivos se recuperaron del PAC y se guardaron.' })
  recuperados!: number;
}

export class ResumenConciliacionDto implements ResumenConciliacion {
  @ApiProperty({ type: ReservasConciliadasDto })
  reservas!: ReservasConciliadasDto;

  @ApiProperty({ type: CancelacionesConciliadasDto })
  cancelaciones!: CancelacionesConciliadasDto;

  @ApiProperty({ type: SustitucionesConciliadasDto })
  sustituciones!: SustitucionesConciliadasDto;

  @ApiProperty({ type: ArchivosConciliadosDto })
  archivos!: ArchivosConciliadosDto;

  @ApiProperty({
    description:
      'Elementos donde el PAC falló o contestó algo que no permite decidir. No se tocaron: la ' +
      'siguiente vuelta los reintenta.',
  })
  fallidas!: number;

  @ApiProperty({
    type: [String],
    example: ['A-1024'],
    description:
      'Serie-folio de reservas que se confirmaron aunque el PAC ya las reporta canceladas (o en ' +
      'cancelación): su cancelación no pasó por aquí y hay que revisarlas a mano en el PAC.',
  })
  requierenRevision!: string[];
}
