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

/**
 * `EstadoAgenteSucursalDto`: una fila de `GET /agentes/estado` (F1-061). Todo null
 * si la sucursal nunca ha reportado.
 */
export interface EstadoAgenteSucursal {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  /** Último lote aceptado, reloj del servidor. */
  ultimoContactoAt: string | null;
  /** Edad del contacto según el servidor: la confiable para "desconectado". */
  edadContactoSegundos: number | null;
  /** Última lectura de SR, reloj de la PC del POS. */
  ultimaLecturaAt: string | null;
  edadLecturaSegundos: number | null;
  versionAgente: string | null;
  versionSr: string | null;
  tamanoCola: number | null;
  /** Latencia de la consulta a SR del último heartbeat, en ms (F1-025). */
  latenciaQueryMs: number | null;
  ultimoError: string | null;
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
  /**
   * En el orden pedido (`orden`/`dir`, F2-222; por default del más reciente al más viejo).
   * Vacío si la página pasa del final.
   */
  items: Ticket[];
  /** Tickets del filtro completo, no de esta página (no es una foto exacta). */
  total: number;
  pagina: number;
  porPagina: number;
  /**
   * Corte por recepción (F2-203): el pedido con `corte`, que filtró la página; sin
   * él, uno SUGERIDO para mandar en todas las páginas de una descarga.
   */
  corte: string;
}

/** `GET /sistema` (F2-202): lo que la SPA necesita saber del servidor antes del login. */
export interface Sistema {
  /** `MODO_DEMO=1` en la API: los datos son de ejemplo. */
  modoDemo: boolean;
}

// ---------------------------------------------------------------------------
// Análisis (F2-221)
// ---------------------------------------------------------------------------

/** `VentaMeseroDto`: una fila de `GET /ventas/por-mesero`, por (sucursal, mesero). */
export interface VentaMesero {
  sucursalId: string;
  sucursal: string;
  /** Null = la cuenta no trae mesero. */
  mesero: string | null;
  venta: Importe;
  cuentas: number;
  ticketPromedio: Importe | null;
  comensales: number;
  cuentasConComensales: number;
  propina: Importe;
  descuentos: { monto: Importe; cuentas: number };
  /** No suman a la venta. */
  cancelados: { cuentas: number; monto: Importe };
  /** F2-231: minutos promedio de sus cuentas, 1 decimal; null sin duraciones válidas. */
  minutosPromedio: string | null;
  cuentasConDuracion: number;
}

/** `VentaPorProductoDto` de `GET /ventas/por-producto`. */
export interface VentaPorProducto {
  venta: Importe;
  cuentas: number;
  /** TODOS los productos, por importe desc. */
  productos: ProductoTop[];
  /** venta − Σ importe: lo que no es de ningún producto. */
  diferenciaCuentas: Importe;
}

/** `CeldaHoraDiaDto`. */
export interface CeldaHoraDia {
  /** ISO: 1 = lunes … 7 = domingo. */
  diaSemana: number;
  hora: number;
  venta: Importe;
  cuentas: number;
}

/** `VentaHoraDiaDto` de `GET /ventas/hora-dia`. */
export interface VentaHoraDia {
  /** 168 celdas. */
  celdas: CeldaHoraDia[];
  /** Cuántas veces cae cada día de la semana en el periodo (0 = no está). */
  diasEnRango: { diaSemana: number; dias: number }[];
}

/** `VentaMesaDto`. */
export interface VentaMesa {
  sucursalId: string;
  sucursal: string;
  mesa: string;
  cuentas: number;
  venta: Importe;
  /** 1 decimal, en texto; null sin duraciones válidas. */
  minutosPromedio: string | null;
  cuentasConDuracion: number;
}

/** `VentaPorMesaDto` de `GET /ventas/por-mesa`. */
export interface VentaPorMesa {
  filas: VentaMesa[];
  sinMesa: { cuentas: number; venta: Importe };
  global: {
    venta: Importe;
    cuentas: number;
    minutosPromedio: string | null;
    cuentasConDuracion: number;
    duracionesInvalidas: number;
    mesas: number;
    cuentasConMesa: number;
    rotacion: string | null;
  };
}

/** Centro de alertas (F2-224): `GET /alertas/*` y `PUT /alertas/reglas/:tipo`. */
export type TipoAlerta =
  'sucursal_sin_reporte' | 'mesa_abierta' | 'cuenta_sin_imprimir' | 'caida_venta';
export type SeveridadAlerta = 'critica' | 'advertencia';
export type MotivoCierreAlerta =
  'condicion' | 'regla_apagada' | 'sucursal_inactiva' | 'empresa_inactiva';

export interface Alerta {
  id: string;
  sucursalId: string;
  sucursal: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  llave: string;
  /** El umbral de la regla cuando abrió (minutos o %). */
  umbral: number;
  /** Por tipo; importes y % como TEXTO decimal (ver OpenAPI de `AlertaDto`). */
  detalle: Record<string, unknown>;
  abiertaAt: string;
  cerradaAt: string | null;
  motivoCierre: MotivoCierreAlerta | null;
}

export interface HistorialAlertas {
  total: number;
  pagina: number;
  porPagina: number;
  filas: Alerta[];
}

export interface ReglaAlerta {
  tipo: TipoAlerta;
  activa: boolean;
  umbral: number;
  porDefecto: boolean;
  unidad: 'minutos' | 'porcentaje';
  minimo: number;
  maximo: number;
  valorPorDefecto: number;
}

/** Reportes por correo (F2-141): `GET/PUT /cuenta/reportes`, vista previa y baja pública. */
export type TipoReporte = 'diario' | 'semanal';
export type EstadoEnvioReporte = 'enviando' | 'enviado' | 'fallido' | 'descartado';

export interface EnvioReporte {
  tipo: TipoReporte;
  /** Diario: el día reportado. Semanal: el lunes de la semana reportada. */
  periodo: string;
  estado: EstadoEnvioReporte;
  intentos: number;
  creadoAt: string;
  enviadoAt: string | null;
}

export interface SuscripcionReporte {
  empresaId: string;
  diario: boolean;
  semanal: boolean;
  zonaHoraria: string;
  horaEnvio: number;
  ultimosEnvios: EnvioReporte[];
}

export interface GuardarSuscripcionReporte {
  empresaId: string;
  diario: boolean;
  semanal: boolean;
}

export interface VistaPreviaReporte {
  tipo: TipoReporte;
  periodo: string;
  asunto: string;
  html: string;
  texto: string;
}

export interface BajaReportes {
  diario: boolean;
  semanal: boolean;
}

// --- Catálogos espejo (F2-230) y orquestador de menú (F2-145) ---------------------

/** `FilaProductoDto` de `GET /catalogos/productos`. */
export interface FilaProducto {
  id: string;
  sucursalId: string;
  sucursal: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  /** false = desapareció de la última sincronización completa (nunca se borra). */
  activo: boolean;
  /** false = baja en el POS; nulo = el POS no lo reporta. */
  activoPos: boolean | null;
  vistoAt: string;
  updatedAt: string;
  grupoOrigenSrId: string | null;
  grupo: string | null;
  /** Texto a 2 decimales, tal como lo reporta el POS; nulo = no lo reporta. */
  precio: string | null;
  tieneMetadata: boolean;
}

/** `PaginaProductosDto`. */
export interface PaginaProductos {
  filas: FilaProducto[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** `MetadataProductoDto`: nuestra, no del POS. */
export interface MetadataProducto {
  descripcion: string | null;
  fotoUrl: string | null;
  etiquetas: string[];
  minimo: string | null;
  maximo: string | null;
  updatedAt: string;
}

/** `DetalleProductoDto` de `GET /catalogos/productos/{id}`. */
export interface DetalleProducto extends FilaProducto {
  metadata: MetadataProducto | null;
}

/** `GuardarMetadataDto` de `PUT /catalogos/productos/{id}/metadata` (reemplazo completo). */
export interface GuardarMetadata {
  empresaId: string;
  descripcion: string | null;
  fotoUrl: string | null;
  etiquetas: string[];
  minimo: string | null;
  maximo: string | null;
}

export type CatalogoSr = 'grupos' | 'productos' | 'meseros' | 'clientes' | 'areas' | 'canales';

/** `EstadoCatalogoDto`. */
export interface EstadoCatalogo {
  catalogo: CatalogoSr;
  ultimaCompletaAt: string | null;
  recibidaAt: string | null;
  total: number | null;
  rechazados: number | null;
  desactivados: number | null;
}

/** `SincronizacionSucursalDto` de `GET /catalogos/sincronizacion`. */
export interface SincronizacionSucursal {
  sucursalId: string;
  sucursal: string;
  catalogos: EstadoCatalogo[];
  solicitud: { solicitadaAt: string | null; pendiente: boolean };
}

/** `SucursalMenuDto`. */
export interface SucursalMenu {
  sucursalId: string;
  sucursal: string;
  /** Nulo = nunca sincronizó completo el catálogo de productos. */
  sincronizadoAt: string | null;
  productos: number;
}

/** `PrecioSucursalDto`. */
export interface PrecioSucursal {
  productoId: string;
  sucursalId: string;
  origenSrId: string;
  nombre: string;
  precio: string | null;
  vigente: boolean;
  tieneMetadata: boolean;
}

/** `ProductoMenuDto`. */
export interface ProductoMenu {
  llave: string;
  criterio: 'clave' | 'nombre';
  clave: string | null;
  nombre: string;
  grupo: string | null;
  gruposDistintos: boolean;
  duplicadoEnSucursal: boolean;
  discrepancia: boolean;
  precioMin: string | null;
  precioMax: string | null;
  precios: PrecioSucursal[];
}

/** `MenuDto` de `GET /catalogos/menu`. */
export interface Menu {
  sucursales: SucursalMenu[];
  categorias: { grupo: string | null; productos: ProductoMenu[] }[];
  productos: number;
  discrepancias: number;
  truncado: boolean;
}

/** `VendidosSinCatalogoDto` de `GET /catalogos/sin-catalogo`. */
export interface VendidosSinCatalogo {
  filas: {
    sucursalId: string;
    sucursal: string;
    producto: string;
    variantes: number;
    partidas: number;
    cantidad: string;
    importe: string;
  }[];
  total: number;
  truncado: boolean;
  sucursalesSinCatalogo: { sucursalId: string; sucursal: string }[];
}

// ---------------------------------------------------------------------------
// Meseros (F2-231): `GET /catalogos/meseros/rendimiento`
// ---------------------------------------------------------------------------

/** Cómo se ligó la fila de venta con el espejo de meseros del POS. */
export type CruceMesero =
  | 'catalogo'
  | 'sin-catalogo'
  | 'ambiguo'
  | 'sin-sincronizar'
  | 'catalogo-incompleto'
  | 'sin-mesero';

export interface MeseroLigado {
  id: string;
  clave: string | null;
  nombre: string;
  /** false = ya no aparece en la última sincronización completa. */
  activo: boolean;
  /** false = dado de baja en el POS; null = el POS no lo reporta. */
  activoPos: boolean | null;
  vistoAt: string;
}

export interface FilaRendimientoMesero {
  sucursalId: string;
  sucursal: string;
  /** Null = "Sin mesero". */
  mesero: string | null;
  textosPos: string[];
  cruce: CruceMesero;
  catalogo: MeseroLigado | null;
  venta: Importe;
  cuentas: number;
  ticketPromedio: Importe | null;
  comensales: number;
  cuentasConComensales: number;
  propina: Importe;
  descuentos: { monto: Importe; cuentas: number };
  cancelados: { cuentas: number; monto: Importe };
  minutosPromedio: string | null;
  cuentasConDuracion: number;
  /** En SU sucursal, por venta; empate = misma posición. Null = fuera del ranking. */
  posicion: number | null;
}

export interface PromedioSucursal {
  ventaPorMesero: Importe | null;
  cuentasPorMesero: string | null;
  propinaPorMesero: Importe | null;
  comensalesPorMesero: string | null;
  /** De TODA la sucursal (también las cuentas sin mesero). */
  ticketPromedio: Importe | null;
  /** De TODA la sucursal. */
  minutosPromedio: string | null;
}

export interface SucursalRendimiento {
  sucursalId: string;
  sucursal: string;
  catalogoSincronizado: boolean;
  meserosEnRanking: number;
  venta: Importe;
  cuentas: number;
  promedio: PromedioSucursal;
}

export interface MeseroSinVentas extends MeseroLigado {
  sucursalId: string;
  sucursal: string;
}

export interface RendimientoMeseros {
  /** Σ venta de `filas` = venta del periodo. */
  venta: Importe;
  cuentas: number;
  descuentos: { monto: Importe; cuentas: number };
  cancelados: { cuentas: number; monto: Importe };
  catalogoTruncado: boolean;
  sucursales: SucursalRendimiento[];
  filas: FilaRendimientoMesero[];
  sinVentas: MeseroSinVentas[];
}

// --- Clientes (F2-232) ------------------------------------------------------------------------

/** `ficha`: en el espejo; `sin-ficha`: las cuentas traen el id y el espejo no; `sin-sincronizar`. */
export type CruceCliente = 'ficha' | 'sin-ficha' | 'sin-sincronizar';
export type EstadoCatalogoClientes = 'sin-sincronizar' | 'vacio' | 'con-clientes';

export interface CifrasCliente {
  /** Cuentas NO canceladas del periodo con este cliente (= Tickets con `canceladas=excluir`). */
  visitas: number;
  venta: Importe;
  ticketPromedio: Importe | null;
  /** Cierre de la última visita del periodo (UTC). */
  ultimaVisita: string | null;
  canceladas: { cuentas: number; monto: Importe };
}

export interface FilaResumenCliente extends CifrasCliente {
  /** Null = no hay ficha que abrir (tampoco filtro de Tickets). */
  id: string | null;
  sucursalId: string;
  sucursal: string;
  cruce: CruceCliente;
  origenSrId: string;
  clave: string | null;
  nombre: string | null;
  activo: boolean | null;
  activoPos: boolean | null;
  /** Sólo con `contacto=true`. */
  telefono?: string | null;
  correo?: string | null;
  rfc?: string | null;
}

export interface SucursalClientes {
  sucursalId: string;
  sucursal: string;
  catalogo: EstadoCatalogoClientes;
  clientesActivos: number;
  cuentas: number;
  cuentasConCliente: number;
}

export interface ResumenClientes {
  usaClientes: boolean;
  catalogoTruncado: boolean;
  cuentas: number;
  cuentasConCliente: number;
  ventaConCliente: Importe;
  sucursales: SucursalClientes[];
  filas: FilaResumenCliente[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface FichaCliente {
  cliente: {
    id: string;
    sucursalId: string;
    sucursal: string;
    origenSrId: string;
    clave: string | null;
    nombre: string;
    telefono: string | null;
    correo: string | null;
    rfc: string | null;
    activo: boolean;
    activoPos: boolean | null;
    vistoAt: string;
  };
  periodo: CifrasCliente;
  productos: Array<{ producto: string; cantidad: string; importe: Importe; cuentas: number }>;
}
