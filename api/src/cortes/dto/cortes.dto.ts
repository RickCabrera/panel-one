import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

import { MAX_DIAS_RANGO } from '../../scope/consulta-ventas';
import { FormasPagoDto, ProductoTopDto } from '../../ventas/dto/ventas.dto';
import type { DetalleCorte, ListaCortes, RenglonCuadre, ResumenCorte } from '../cortes.service';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día LOCAL de la sucursal (`YYYY-MM-DD`), inclusivo. Cada sucursal se corta en SU zona. ' +
  `Rango máximo: ${MAX_DIAS_RANGO} días.`;
const DINERO = { type: String, example: '1234.50', description: 'Pesos, 2 decimales, en texto.' };

export class AlcanceCortesQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Empresa a consultar. Fuera del alcance = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Una sucursal de esa empresa. Sin él, todas. De otra empresa = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  sucursalId?: string;
}

export class CortesQueryDto extends AlcanceCortesQueryDto {
  @ApiProperty({ example: '2026-10-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-10-31', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

export class ResumenCorteDto implements ResumenCorte {
  @ApiProperty({ format: 'uuid', description: 'Id del corte en el panel (para el detalle).' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona IANA de la sucursal.' })
  zonaHoraria!: string;

  @ApiProperty({ example: '12', description: '`turnos.idturno` de SoftRestaurant.' })
  turnoSr!: string;

  @ApiProperty({ format: 'date-time', description: 'Apertura del turno, UTC.' })
  aperturaAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cierre (corte) del turno, UTC. Null = turno abierto.',
  })
  cierreAt!: string | null;

  @ApiProperty({ description: 'Turno sin cierre: las cifras son el acumulado en curso.' })
  abierto!: boolean;

  @ApiProperty({ type: String, nullable: true, description: '`turnos.idestacion` de SR.' })
  estacion!: string | null;

  @ApiProperty({ ...DINERO, description: 'Fondo inicial de caja.' })
  fondo!: string;

  @ApiProperty({
    ...DINERO,
    description:
      'Σ total (sin propina) de las cuentas NO canceladas cobradas en el turno (`idturno` del ' +
      'cobro). Es la cifra que cuadra con el Corte X de SR.',
  })
  venta!: string;

  @ApiProperty({ description: 'Cuentas no canceladas cobradas en el turno.' })
  cuentas!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'venta / cuentas; null sin cuentas.',
  })
  ticketPromedio!: string | null;

  @ApiProperty({
    description:
      'El turno se CERRÓ antes de que llegara a la API el primer turno de su sucursal (antes de que ' +
      'el agente mandara turnos y el turno de cada cuenta): sus cuentas pueden no estar ligadas y la ' +
      'venta puede salir incompleta. Un turno abierto nunca lo es.',
  })
  posiblementeIncompleto!: boolean;
}

export class ListaCortesDto implements ListaCortes {
  @ApiProperty({ type: [ResumenCorteDto], description: 'Apertura más reciente primero.' })
  cortes!: ResumenCorteDto[];

  @ApiProperty({ description: 'Hubo más de 500 turnos en el rango: sólo salen los más recientes.' })
  truncado!: boolean;
}

class ComensalesCorteDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({ description: 'Cuentas que traían comensales (SR puede no reportarlos).' })
  cuentasConDato!: number;
}

class DescuentosCorteDto {
  @ApiProperty(DINERO)
  monto!: string;

  @ApiProperty({ description: 'Cuentas con descuento distinto de cero.' })
  cuentas!: number;
}

class CanceladosCorteDto {
  @ApiProperty()
  cuentas!: number;

  @ApiProperty({ ...DINERO, description: 'Σ total de las canceladas del turno (no suman).' })
  monto!: string;
}

class RenglonCuadreDto implements RenglonCuadre {
  @ApiProperty({ enum: ['efectivo', 'tarjeta', 'vales', 'credito', 'total'] })
  concepto!: RenglonCuadre['concepto'];

  @ApiProperty({ ...DINERO, description: 'Lo que el cajero DECLARÓ en SR al cerrar el turno.' })
  declarado!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Lo cobrado en el turno por esa forma (pagos, sin propina ni cambio). Null si SR declara ' +
      'un concepto sin forma equivalente en el panel (vales, crédito).',
  })
  cobrado!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'declarado − cobrado. Null sin cobrado comparable o con el turno abierto. SUPUESTO: no se ' +
      'ha visto si el efectivo declarado en SR incluye fondo o propinas (esquema-sr.md §2).',
  })
  diferencia!: string | null;
}

export class DetalleCorteDto extends ResumenCorteDto implements DetalleCorte {
  @ApiProperty({ type: ComensalesCorteDto })
  comensales!: ComensalesCorteDto;

  @ApiProperty({ ...DINERO, description: 'Σ propina de las cuentas cobradas en el turno.' })
  propina!: string;

  @ApiProperty({ type: DescuentosCorteDto })
  descuentos!: DescuentosCorteDto;

  @ApiProperty({ type: CanceladosCorteDto })
  cancelados!: CanceladosCorteDto;

  @ApiProperty({
    type: FormasPagoDto,
    description: 'Lo cobrado por forma de pago, con el catálogo de la empresa aplicado al leer.',
  })
  formasPago!: FormasPagoDto;

  @ApiProperty({
    ...DINERO,
    description: 'Σ pagos de las cuentas no canceladas del turno (= Σ de `formasPago`).',
  })
  cobrado!: string;

  @ApiProperty({
    type: [RenglonCuadreDto],
    description:
      'Declarado por el cajero contra lo cobrado: efectivo, tarjeta, vales, crédito, total.',
  })
  cuadre!: RenglonCuadreDto[];

  @ApiProperty({
    type: [ProductoTopDto],
    description: 'Los 10 productos con más importe en el turno (por nombre).',
  })
  topProductos!: ProductoTopDto[];
}
