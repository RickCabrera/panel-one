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
