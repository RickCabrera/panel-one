import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoSuscripcion, MetodoPago, PeriodicidadPlan, RolUsuario } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/dto/password.dto';
import { ESTADOS_EFECTIVOS, type EstadoEfectivo, type EstadoPagoMes } from '../membresia';

const NOMBRE_MAX = 120;
/** Dinero: hasta 10 enteros y 2 decimales, en texto (nunca float). */
export const REGEX_MONTO = /^\d{1,10}(\.\d{1,2})?$/;
/** Día de calendario. Que exista de verdad (no 2026-02-30) lo revisa el servicio. */
export const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
export const REGEX_RFC = /^([A-ZÑ&]{3,4})\d{6}[A-Z0-9]{3}$/;

/** Los colores de interfaz que se pueden elegir (mismo CHECK que la migración). */
export const COLORES_ACENTO = [
  'naranja',
  'morado',
  'azul_electrico',
  'verde_azulado',
  'ambar_dorado',
  'magenta',
  'rojo',
] as const;
export type ColorAcento = (typeof COLORES_ACENTO)[number];

const Recortar = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
/** Recorta, y un texto que queda vacío se guarda como NULL (campos opcionales de texto libre). */
const RecortarONulo = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const limpio = value.trim();
    return limpio.length === 0 ? null : limpio;
  });
const Minusculas = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
const Mayusculas = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
/** En un PATCH el campo puede faltar, pero NO venir `null` si la columna es NOT NULL. */
const SiViene = () => ValidateIf((_o: object, v: unknown) => v !== undefined);
/** Puede faltar o venir `null` (columna NULL). */
const SiVieneNoNulo = () => ValidateIf((_o: object, v: unknown) => v !== undefined && v !== null);

// --- Planes ------------------------------------------------------------------------------------

export class PlanDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ type: String, nullable: true })
  descripcion!: string | null;

  @ApiProperty({ example: '499.00', description: 'MXN al mes, en texto con 2 decimales.' })
  precioMensual!: string;

  @ApiProperty({ enum: PeriodicidadPlan, enumName: 'PeriodicidadPlan' })
  periodicidad!: PeriodicidadPlan;

  @ApiProperty({ type: Number, nullable: true, description: 'Nulo = sucursales ilimitadas.' })
  limiteSucursales!: number | null;

  @ApiProperty()
  activo!: boolean;

  @ApiProperty({ description: 'Clientes con este plan (cualquier estado).' })
  clientes!: number;
}

export class CrearPlanDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(500)
  descripcion?: string | null;

  @ApiProperty({ example: '499.00', description: 'Precio MENSUAL en MXN (texto, 2 decimales).' })
  @IsString()
  @Matches(REGEX_MONTO, { message: 'precioMensual debe ser un importe con hasta 2 decimales' })
  precioMensual!: string;

  @ApiPropertyOptional({
    enum: PeriodicidadPlan,
    enumName: 'PeriodicidadPlan',
    description: 'Cada cuánto se cobra. Anual = 12 × precio mensual por periodo.',
  })
  @IsOptional()
  @IsEnum(PeriodicidadPlan)
  periodicidad?: PeriodicidadPlan;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 1000 })
  @IsOptional()
  @SiVieneNoNulo()
  @IsInt()
  @Min(1)
  @Max(1000)
  limiteSucursales?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class EditarPlanDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(500)
  descripcion?: string | null;

  @ApiPropertyOptional({ example: '499.00' })
  @SiViene()
  @IsString()
  @Matches(REGEX_MONTO, { message: 'precioMensual debe ser un importe con hasta 2 decimales' })
  precioMensual?: string;

  @ApiPropertyOptional({ enum: PeriodicidadPlan, enumName: 'PeriodicidadPlan' })
  @SiViene()
  @IsEnum(PeriodicidadPlan)
  periodicidad?: PeriodicidadPlan;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 1000 })
  @SiVieneNoNulo()
  @IsInt()
  @Min(1)
  @Max(1000)
  limiteSucursales?: number | null;

  @ApiPropertyOptional({
    description: '`false` lo esconde de las altas; quien ya lo tiene, sigue.',
  })
  @SiViene()
  @IsBoolean()
  activo?: boolean;
}

// --- Suscripción y clientes --------------------------------------------------------------------

export class SuscripcionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: PlanDto })
  plan!: Omit<PlanDto, 'clientes'>;

  @ApiProperty({
    enum: EstadoSuscripcion,
    enumName: 'EstadoSuscripcion',
    description: 'El estado GUARDADO (nunca `vencida`).',
  })
  estado!: EstadoSuscripcion;

  @ApiProperty({
    enum: ESTADOS_EFECTIVOS,
    enumName: 'EstadoMembresia',
    description:
      'El que cuenta: el guardado, salvo `prueba`/`activa` con hoy > vencimiento + gracia, ' +
      'que es `vencida` (se calcula al leer).',
  })
  estadoEfectivo!: EstadoEfectivo;

  @ApiProperty({ example: '2026-11-03', description: 'Día de calendario.' })
  inicio!: string;

  @ApiProperty({ example: '2026-12-05', description: 'Próximo pago (día de calendario).' })
  vencimiento!: string;

  @ApiProperty({ example: '2026-12-10', description: 'Vencimiento + días de gracia.' })
  fechaLimite!: string;

  @ApiProperty()
  diasGracia!: number;

  @ApiProperty({ minimum: 1, maximum: 28 })
  diaCorte!: number;

  @ApiProperty({ type: String, nullable: true })
  notas!: string | null;
}

export class UltimoPagoDto {
  @ApiProperty({ example: '2026-11-02' })
  fechaPago!: string;

  @ApiProperty({ example: '499.00' })
  monto!: string;

  @ApiProperty({ example: 'MXN' })
  moneda!: string;
}

export class ClienteResumenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ description: '`false`: dada de baja en Administración (nadie entra).' })
  activo!: boolean;

  @ApiProperty({ type: SuscripcionDto, nullable: true, description: 'Nula = sin suscripción.' })
  suscripcion!: SuscripcionDto | null;

  @ApiProperty({ type: UltimoPagoDto, nullable: true })
  ultimoPago!: UltimoPagoDto | null;

  @ApiProperty({ description: 'Sucursales activas.' })
  sucursales!: number;

  @ApiProperty({ description: 'Sucursales cuyo agente se reportó en los últimos 10 minutos.' })
  agentesConectados!: number;

  @ApiProperty({ description: 'Usuarios activos.' })
  usuarios!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo llegó a la API la última venta (cheque) de cualquiera de sus sucursales.',
  })
  ultimaVentaRecibidaAt!: string | null;
}

export class ContactoDto {
  @ApiProperty({ type: String, nullable: true })
  contactoNombre!: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactoTelefono!: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactoEmail!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rfc!: string | null;

  @ApiProperty({ type: String, nullable: true })
  notasPlataforma!: string | null;
}

export class SucursalClienteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  activo!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ultimoContactoAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  versionAgente!: string | null;

  @ApiProperty({ description: 'Tiene API key (el agente se puede instalar).' })
  tieneApiKey!: boolean;
}

export class UsuarioClienteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: RolUsuario, enumName: 'RolUsuario' })
  rol!: RolUsuario;

  @ApiProperty()
  activo!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ultimoAccesoAt!: string | null;
}

export class PagoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  empresaId!: string;

  @ApiProperty({ example: '499.00' })
  monto!: string;

  @ApiProperty({ example: 'MXN' })
  moneda!: string;

  @ApiProperty({ example: '2026-11-02' })
  fechaPago!: string;

  @ApiProperty({ enum: MetodoPago, enumName: 'MetodoPago' })
  metodo!: MetodoPago;

  @ApiProperty({ type: String, nullable: true })
  referencia!: string | null;

  @ApiProperty({ example: '2026-11-05' })
  periodoDesde!: string;

  @ApiProperty({ example: '2026-12-05', description: 'Exclusivo: el nuevo vencimiento.' })
  periodoHasta!: string;

  @ApiProperty({ type: String, nullable: true })
  notas!: string | null;

  @ApiProperty({ description: 'Quién lo registró (nombre y correo).' })
  registradoPor!: string;

  @ApiProperty({ format: 'date-time' })
  registradoAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  anuladoAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  anuladoPor!: string | null;

  @ApiProperty({ type: String, nullable: true })
  motivoAnulacion!: string | null;
}

export class ClienteDetalleDto extends ClienteResumenDto {
  @ApiProperty({ type: ContactoDto })
  contacto!: ContactoDto;

  @ApiProperty({ format: 'date-time' })
  creadaAt!: string;

  @ApiProperty({ type: [SucursalClienteDto] })
  listaSucursales!: SucursalClienteDto[];

  @ApiProperty({ type: [UsuarioClienteDto] })
  listaUsuarios!: UsuarioClienteDto[];

  @ApiProperty({
    type: [PagoDto],
    description: 'Del más reciente al más viejo, anulados incluidos.',
  })
  pagos!: PagoDto[];
}

export class ClientesQueryDto {
  @ApiPropertyOptional({
    enum: [...ESTADOS_EFECTIVOS, 'sin_suscripcion'],
    description: 'Filtra por estado EFECTIVO.',
  })
  @IsOptional()
  @IsIn([...ESTADOS_EFECTIVOS, 'sin_suscripcion'])
  estado?: EstadoEfectivo | 'sin_suscripcion';

  @ApiPropertyOptional({ maxLength: 120, description: 'Busca en el nombre (sin mayúsculas).' })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(120)
  q?: string;
}

class AdministradorClienteDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ maxLength: 254, description: 'Se guarda en minúsculas. Duplicado = 409.' })
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

/** Los datos de contacto, en alta y en edición: todos opcionales y anulables. */
class CamposContacto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(120)
  contactoNombre?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 30 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @Matches(/^[0-9+()\-\s]{7,30}$/, { message: 'contactoTelefono no parece un teléfono' })
  contactoTelefono?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsEmail()
  @MaxLength(254)
  contactoEmail?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'RFC (12 o 13), mayúsculas.' })
  @Mayusculas()
  @RecortarONulo()
  @SiVieneNoNulo()
  @Matches(REGEX_RFC, { message: 'rfc no tiene formato de RFC' })
  rfc?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(2000)
  notasPlataforma?: string | null;
}

export class AltaClienteDto extends CamposContacto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX, description: 'Nombre del negocio.' })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ format: 'uuid', description: 'Un plan ACTIVO (inactivo o inexistente = 400).' })
  @IsUUID('all')
  planId!: string;

  @ApiPropertyOptional({ enum: ['prueba', 'activa'], default: 'activa' })
  @IsOptional()
  @IsIn(['prueba', 'activa'])
  estado?: 'prueba' | 'activa';

  @ApiProperty({ minimum: 1, maximum: 28, description: 'Día del mes en que se cobra.' })
  @IsInt()
  @Min(1)
  @Max(28)
  diaCorte!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 60, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  diasGracia?: number;

  @ApiPropertyOptional({
    example: '2026-12-05',
    description: 'Primer vencimiento. Si no viene: el siguiente día de corte después de hoy.',
  })
  @IsOptional()
  @Matches(REGEX_DIA)
  vencimiento?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(2000)
  notasSuscripcion?: string | null;

  @ApiProperty({ type: AdministradorClienteDto, description: 'Su primer admin_empresa.' })
  @ValidateNested()
  @Type(() => AdministradorClienteDto)
  administrador!: AdministradorClienteDto;
}

export class EditarClienteDto extends CamposContacto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NOMBRE_MAX })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;
}

export class GuardarSuscripcionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Cambia el plan (activo). Obligatorio si la empresa aún no tiene suscripción.',
  })
  @SiViene()
  @IsUUID('all')
  planId?: string;

  @ApiPropertyOptional({ example: '2026-12-05', description: 'Corrige el próximo pago a mano.' })
  @SiViene()
  @Matches(REGEX_DIA)
  vencimiento?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 28 })
  @SiViene()
  @IsInt()
  @Min(1)
  @Max(28)
  diaCorte?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @SiViene()
  @IsInt()
  @Min(0)
  @Max(60)
  diasGracia?: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(2000)
  notas?: string | null;
}

export class CambiarEstadoDto {
  @ApiProperty({
    enum: EstadoSuscripcion,
    enumName: 'EstadoSuscripcion',
    description:
      '`suspendida`/`cancelada` dejan fuera a los usuarios de la empresa (no entran ni refrescan). ' +
      '`activa`/`prueba` los dejan entrar otra vez. `vencida` no se pone a mano: se calcula.',
  })
  @IsEnum(EstadoSuscripcion)
  estado!: EstadoSuscripcion;

  @ApiPropertyOptional({ maxLength: 500, description: 'Queda en la bitácora.' })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class RegistrarPagoDto {
  @ApiProperty({ example: '499.00', description: 'Importe (> 0, 2 decimales), en texto.' })
  @IsString()
  @Matches(REGEX_MONTO, { message: 'monto debe ser un importe con hasta 2 decimales' })
  monto!: string;

  @ApiPropertyOptional({ example: 'MXN', default: 'MXN' })
  @IsOptional()
  @Mayusculas()
  @Matches(/^[A-Z]{3}$/)
  moneda?: string;

  @ApiProperty({ example: '2026-11-02', description: 'Día en que llegó el dinero. No futuro.' })
  @Matches(REGEX_DIA)
  fechaPago!: string;

  @ApiProperty({ enum: MetodoPago, enumName: 'MetodoPago' })
  @IsEnum(MetodoPago)
  metodo!: MetodoPago;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(120)
  referencia?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @RecortarONulo()
  @SiVieneNoNulo()
  @IsString()
  @MaxLength(1000)
  notas?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 24,
    default: 1,
    description: 'Periodos del plan que cubre (meses si es mensual, años si es anual).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  periodos?: number;
}

export class AnularPagoDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Recortar()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}

export class PagoRegistradoDto {
  @ApiProperty({ type: PagoDto })
  pago!: PagoDto;

  @ApiProperty({ type: SuscripcionDto })
  suscripcion!: SuscripcionDto;
}

export class AltaClienteHechaDto {
  @ApiProperty({ type: ClienteDetalleDto })
  cliente!: ClienteDetalleDto;
}

// --- Pagos del mes -----------------------------------------------------------------------------

export class PagosQueryDto {
  @ApiPropertyOptional({ enum: ['pagado', 'pendiente', 'vencido'] })
  @IsOptional()
  @IsIn(['pagado', 'pendiente', 'vencido'])
  estado?: EstadoPagoMes;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class MensualidadDto {
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;

  @ApiProperty()
  empresa!: string;

  @ApiProperty()
  empresaActiva!: boolean;

  @ApiProperty()
  plan!: string;

  @ApiProperty({ example: '499.00' })
  precioMensual!: string;

  @ApiProperty()
  diaCorte!: number;

  @ApiProperty({ example: '2026-12-05' })
  vencimiento!: string;

  @ApiProperty({ enum: ESTADOS_EFECTIVOS, enumName: 'EstadoMembresia' })
  estadoEfectivo!: EstadoEfectivo;

  @ApiProperty({ enum: ['pagado', 'pendiente', 'vencido'] })
  estadoPago!: EstadoPagoMes;

  @ApiProperty({ type: UltimoPagoDto, nullable: true })
  ultimoPago!: UltimoPagoDto | null;
}

export class ConteoPagosDto {
  @ApiProperty()
  todos!: number;
  @ApiProperty()
  pagados!: number;
  @ApiProperty()
  pendientes!: number;
  @ApiProperty()
  vencidos!: number;
}

export class PagosMesDto {
  @ApiProperty({ example: '2026-11', description: 'El mes en curso (hora de CDMX).' })
  mes!: string;

  @ApiProperty({ type: ConteoPagosDto, description: 'Conteos SIN el filtro de estado.' })
  conteos!: ConteoPagosDto;

  @ApiProperty({ example: '2495.00', description: 'Pagos no anulados con fecha en el mes.' })
  cobradoMes!: string;

  @ApiProperty({ type: [MensualidadDto] })
  mensualidades!: MensualidadDto[];
}

// --- Métricas ----------------------------------------------------------------------------------

export class MetricasDto {
  @ApiProperty({
    example: '2495.00',
    description: 'Σ precio mensual de los planes de las suscripciones activas o vencidas.',
  })
  mrr!: string;

  @ApiProperty()
  activos!: number;
  @ApiProperty()
  prueba!: number;
  @ApiProperty()
  vencidos!: number;
  @ApiProperty()
  suspendidos!: number;
  @ApiProperty()
  cancelados!: number;
  @ApiProperty({ description: 'Empresas sin suscripción (nacieron fuera del panel).' })
  sinSuscripcion!: number;

  @ApiProperty({
    example: '2495.00',
    description: 'Pagos no anulados con fecha en el mes en curso.',
  })
  ingresosMes!: string;

  @ApiProperty({
    description: 'Prueba/activa (no vencidas) que vencen hoy o en los próximos 7 días.',
  })
  vencenProximos7Dias!: number;

  @ApiProperty({ example: '2026-11-03', description: 'El "hoy" de las cifras (CDMX).' })
  hoy!: string;
}

// --- Administradores internos ------------------------------------------------------------------

export class AdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  nombre!: string;
  @ApiProperty()
  email!: string;
  @ApiProperty()
  activo!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ultimoAccesoAt!: string | null;
}

export class CrearAdminDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ maxLength: 254, description: 'Se guarda en minúsculas. Duplicado = 409.' })
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    format: 'password',
    description: 'Contraseña INICIAL. Después sólo la cambia él mismo (Mi cuenta).',
  })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class EditarAdminDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NOMBRE_MAX })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @SiViene()
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    description: '`false` desactiva (nunca a ti mismo; siempre queda uno activo). No hay borrado.',
  })
  @SiViene()
  @IsBoolean()
  activo?: boolean;
}

export class BuscarCuentaQueryDto {
  @ApiProperty({ maxLength: 254 })
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class CuentaClienteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  nombre!: string;
  @ApiProperty()
  email!: string;
  @ApiProperty({ enum: RolUsuario, enumName: 'RolUsuario' })
  rol!: RolUsuario;
  @ApiProperty()
  activo!: boolean;
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;
  @ApiProperty()
  empresa!: string;
}

export class ConvertirCuentaDto {
  @ApiProperty({ format: 'uuid', description: 'El usuario que devolvió la búsqueda.' })
  @IsUUID('all')
  usuarioId!: string;
}

export class CuentaConvertidaDto {
  @ApiProperty({ type: AdminDto })
  admin!: AdminDto;

  @ApiProperty({ format: 'uuid', description: 'La empresa de la que salió.' })
  empresaId!: string;

  @ApiProperty({ description: 'La empresa se quedó sin ningún admin_empresa activo.' })
  empresaSinAdmin!: boolean;
}

// --- Bitácora ----------------------------------------------------------------------------------

export class BitacoraQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  pagina?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  porPagina?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  empresaId?: string;
}

export class EntradaBitacoraDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'uuid' })
  actorId!: string;
  @ApiProperty()
  actorEmail!: string;
  @ApiProperty({ example: 'pago.registrar' })
  accion!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  empresaId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  empresa!: string | null;
  @ApiProperty({ type: String, nullable: true })
  recurso!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recursoId!: string | null;
  @ApiProperty({ type: Object, nullable: true, description: 'JSON. Nunca contraseñas ni hashes.' })
  antes!: unknown;
  @ApiProperty({ type: Object, nullable: true })
  despues!: unknown;
}

export class BitacoraDto {
  @ApiProperty()
  total!: number;
  @ApiProperty()
  pagina!: number;
  @ApiProperty()
  porPagina!: number;
  @ApiProperty({ type: [EntradaBitacoraDto] })
  entradas!: EntradaBitacoraDto[];
}

// --- Ajustes y membresía propia ----------------------------------------------------------------

export class AjustesDto {
  @ApiProperty({
    enum: COLORES_ACENTO,
    nullable: true,
    description: 'Color de interfaz para TODOS los clientes. Nulo = el del build.',
  })
  colorAcento!: ColorAcento | null;
}

export class GuardarAjustesDto {
  @ApiProperty({ enum: COLORES_ACENTO, nullable: true, description: 'Nulo = volver al del build.' })
  // Obligatorio: puede ser `null`, pero no faltar.
  @ValidateIf((_o: object, v: unknown) => v !== null)
  @IsIn(COLORES_ACENTO)
  colorAcento!: ColorAcento | null;
}

export class MembresiaPropiaDto {
  @ApiProperty({ enum: ESTADOS_EFECTIVOS, enumName: 'EstadoMembresia' })
  estado!: EstadoEfectivo;

  @ApiProperty({ example: '2026-12-05' })
  vencimiento!: string;

  @ApiProperty({ example: '2026-12-10', description: 'Vencimiento + gracia.' })
  fechaLimite!: string;

  @ApiProperty()
  plan!: string;
}

export class RespuestaMembresiaDto {
  @ApiProperty({
    type: MembresiaPropiaDto,
    nullable: true,
    description: 'Nula para admin_global o para una empresa sin suscripción.',
  })
  membresia!: MembresiaPropiaDto | null;
}
