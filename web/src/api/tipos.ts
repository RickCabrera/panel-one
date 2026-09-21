/**
 * Tipos del contrato de la API, escritos a mano campo por campo contra
 * `api/openapi.json` (la fuente única del contrato). Si el OpenAPI cambia, esto
 * cambia en el mismo entregable.
 */

/** `RolUsuario` del OpenAPI. */
export type Rol = 'admin_global' | 'admin_empresa' | 'visor';

/** `UsuarioActualDto`. */
export interface UsuarioActual {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  /** Nulo sólo para admin_global. */
  empresaId: string | null;
}

/** `SesionDto`: respuesta de `POST /auth/login` y `POST /auth/refresh`. */
export interface Sesion {
  accessToken: string;
  /** Vida del access token, en segundos. */
  expiresIn: number;
  usuario: UsuarioActual;
}

/** `EmpresaDto`. */
export interface Empresa {
  id: string;
  nombre: string;
  activo: boolean;
}

/** `SucursalDto`. */
export interface Sucursal {
  id: string;
  empresaId: string;
  nombre: string;
  zonaHoraria: string;
  activo: boolean;
}

/** `UsuarioDto` de `GET/POST/PATCH /usuarios` (F1-060). Nunca trae el hash. */
export interface UsuarioAdmin {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  /** Nulo sólo para admin_global. */
  empresaId: string | null;
  activo: boolean;
}

/** `CrearUsuarioDto`. `empresaId` va nulo/ausente sólo para admin_global. */
export interface CrearUsuario {
  email: string;
  nombre: string;
  rol: Rol;
  empresaId?: string | null;
  /** 12..128 caracteres. */
  password: string;
}

/** `EditarUsuarioDto`: sólo los campos que cambian. */
export interface EditarUsuario {
  nombre?: string;
  rol?: Rol;
  activo?: boolean;
}

/** `CrearSucursalDto`. `zonaHoraria` es un nombre IANA (`America/Mexico_City`). */
export interface CrearSucursal {
  empresaId: string;
  nombre: string;
  zonaHoraria: string;
}

/** `EditarSucursalDto`. */
export interface EditarSucursal {
  nombre?: string;
  zonaHoraria?: string;
  activo?: boolean;
}

/** `EditarEmpresaDto`. */
export interface EditarEmpresa {
  nombre?: string;
  activo?: boolean;
}

/** `ApiKeyEmitidaDto` de `POST /sucursales/:id/api-key`: la key en claro, UNA sola vez. */
export interface ApiKeyEmitida {
  sucursalId: string;
  apiKey: string;
}

/** `CambiarPasswordDto` de `POST /cuenta/password`; responde un `Sesion`. */
export interface CambiarPassword {
  actual: string;
  nueva: string;
}

/** Largo de toda contraseña nueva (`PASSWORD_MIN`/`PASSWORD_MAX` del API). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** `ErrorDto`: cuerpo de todo error de la API. */
export interface ErrorCuerpo {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/** Importe: pesos con 2 decimales, en texto (`"1234.50"`). Se suma con `dinero.ts`. */
export type Importe = string;

/** `ResumenDto` de `GET /ventas/resumen`. */
export interface Resumen {
  venta: Importe;
  cuentas: number;
  /** Null sin cuentas: un promedio sin divisor es null. */
  ticketPromedio: Importe | null;
  subtotal: Importe;
  impuestos: Importe;
  propina: Importe;
  descuentos: { monto: Importe; cuentas: number };
  /** Siempre null: el modelo aún no distingue una cortesía (esquema-sr.md §2). */
  cortesias: null;
  comensales: {
    total: number;
    cuentasConDato: number;
    promedioPorComensal: Importe | null;
  };
  cancelados: { cuentas: number };
}

/** `VentaHoraDto`: una de las 24 filas de `GET /ventas/por-hora`. */
export interface VentaHora {
  /** Hora local de cierre en la sucursal, 0..23. */
  hora: number;
  venta: Importe;
  cuentas: number;
}

/**
 * `VentaDiaDto`: una fila de `GET /ventas/por-dia` (F1-043). Una por cada día de
 * `desde..hasta`, con cero donde no hubo. Con varias sucursales en zonas distintas,
 * cada cuenta cae en el día de SU zona.
 */
export interface VentaDia {
  /** `YYYY-MM-DD`, día local de cierre. */
  dia: string;
  venta: Importe;
  cuentas: number;
}

/** `VentaSucursalDto`: una fila de `GET /ventas/comparativo-sucursales` (F1-043). */
export interface VentaSucursal {
  sucursalId: string;
  nombre: string;
  venta: Importe;
  /** Cuentas no canceladas cerradas en el rango. */
  cuentas: number;
  /** Null si la sucursal no tuvo cuentas en el rango. */
  ticketPromedio: Importe | null;
  comensales: number;
}

/** `ProductoTopDto`: una fila de `GET /ventas/top-productos`. */
export interface ProductoTop {
  producto: string;
  /** Σ partidas, ANTES del descuento del cheque: no cuadra con la venta. */
  importe: Importe;
  /** 3 decimales, en texto (`"2.000"`). */
  cantidad: string;
}

/** `FormaPago` del OpenAPI. */
export type FormaPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';

/** `FormasPagoDto` de `GET /ventas/formas-pago`. */
export interface FormasPago {
  /** Las cuatro formas, siempre y en este orden. */
  formas: { forma: FormaPago; monto: Importe }[];
  /** Formas de SR sin catálogo (ya sumadas en `otro`). */
  sinCatalogo: { formaRaw: string; monto: Importe }[];
}

/** `SnapshotMesasDto`. */
export interface SnapshotMesas {
  capturadoAt: string;
  recibidoAt: string;
  edadSegundos: number;
  /** Edad según el reloj del servidor: la confiable. */
  edadRecepcionSegundos: number;
  /** La forma de cada mesa todavía no se fija (esquema-sr.md §5). */
  mesas: Record<string, unknown>[];
}

/** `MesasSucursalDto`: una fila de `GET /mesas/abiertas`. */
export interface MesasSucursal {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  snapshot: SnapshotMesas | null;
}

/** `ModificadorDto`: como los guardó la ingesta (esquema-sr.md §13). */
export interface Modificador {
  nombre: string;
  precio: Importe;
}

/** `PartidaTicketDto`. */
export interface PartidaTicket {
  producto: string;
  categoria: string | null;
  /** 3 decimales, en texto (`"2.000"`). */
  cantidad: string;
  precioUnit: Importe;
  total: Importe;
  modificadores: Modificador[];
}

/** `PagoTicketDto`. */
export interface PagoTicket {
  /** Texto de SR. */
  formaRaw: string;
  /** Derivada al leer con el catálogo de la empresa; sin entrada = `otro`. */
  forma: FormaPago;
  monto: Importe;
}

/** `TicketDto`: un cheque de `GET /ventas/tickets`, con su detalle inline. */
export interface Ticket {
  id: string;
  sucursalId: string;
  folio: string;
  mesa: string | null;
  mesero: string | null;
  /** Null = SR no lo reportó. */
  comensales: number | null;
  /** UTC. */
  abiertoAt: string;
  /** UTC. Null en un cancelado que nunca se cerró. */
  cerradoAt: string | null;
  /** Se lista pero NO suma: ni en un total ni en un export. */
  cancelado: boolean;
  subtotal: Importe;
  impuestos: Importe;
  descuentos: Importe;
  propina: Importe;
  total: Importe;
  /** En el orden del POS. */
  partidas: PartidaTicket[];
  pagos: PagoTicket[];
}

/** `PaginaTicketsDto`. */
export interface PaginaTickets {
  /** Del más reciente al más viejo. Vacío si la página pasa del final. */
  items: Ticket[];
  /** Tickets del filtro completo, no de esta página (no es una foto exacta). */
  total: number;
  pagina: number;
  porPagina: number;
}
