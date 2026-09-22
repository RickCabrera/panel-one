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
  | 'sucursal_sin_reporte'
  | 'mesa_abierta'
  | 'cuenta_sin_imprimir'
  | 'caida_venta'
  // F2-121: un artículo por debajo de su mínimo en su almacén.
  | 'bajo_minimo'
  // F2-124: un traspaso del panel sin conciliar con SR pasado su umbral (horas).
  | 'traspaso_sin_conciliar';
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
  /** El umbral de la regla cuando abrió (minutos, % u horas). */
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
  unidad: 'minutos' | 'porcentaje' | 'horas';
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

/** `CatalogoSr` del API: los seis de F2-230 y los cinco de inventario de F2-120. */
export type CatalogoSr =
  | 'grupos'
  | 'productos'
  | 'meseros'
  | 'clientes'
  | 'areas'
  | 'canales'
  | 'unidades'
  | 'grupos_insumo'
  | 'insumos'
  | 'almacenes'
  | 'proveedores';

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

/** Áreas y canales (F2-233): `GET /ventas/por-area` y el mapeo área → canal de negocio. */
export type CanalNegocio = 'comedor' | 'mostrador' | 'domicilio' | 'plataformas';
export type CruceArea = 'catalogo' | 'sin-catalogo' | 'sin-sincronizar';

export interface MontoArea {
  venta: Importe;
  cuentas: number;
}

export interface FilaVentaArea extends MontoArea {
  sucursalId: string;
  sucursal: string;
  areaOrigenSrId: string;
  areaId: string | null;
  clave: string | null;
  nombre: string | null;
  cruce: CruceArea;
  activo: boolean | null;
  canal: CanalNegocio | null;
}

export interface VentaPorArea extends MontoArea {
  areas: FilaVentaArea[];
  /** "Sin clasificar": la cuenta no trae área. */
  sinArea: MontoArea;
  canales: Array<MontoArea & { canal: CanalNegocio }>;
  /** Área sin canal asignado, o que no está en el catálogo. */
  sinCanal: MontoArea;
  catalogo: Array<{ sucursalId: string; sucursal: string; sincronizado: boolean }>;
}

export interface FilaMapeoArea {
  id: string;
  sucursalId: string;
  sucursal: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  canal: CanalNegocio | null;
  canalActualizadoAt: string | null;
}

export interface MapeoAreas {
  sucursales: Array<{ sucursalId: string; sucursal: string; ultimaCompletaAt: string | null }>;
  areas: FilaMapeoArea[];
  truncado: boolean;
}

// ---------------------------------------------------------------------------
// Existencias (F2-121): `GET /inventario/existencias` y `PUT /inventario/existencias/limites`
// ---------------------------------------------------------------------------

/** `EstadoExistencia` del API: el semáforo de cada artículo. */
export type EstadoExistencia =
  'sin_existencia' | 'bajo_minimo' | 'sobre_maximo' | 'ok' | 'sin_limites' | 'sin_lectura';

/** Cantidades (NUMERIC(12,3)) y dinero como TEXTO decimal. Nulo = sin lectura. */
export interface FilaExistencia {
  sucursalId: string;
  sucursal: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  cantidad: string | null;
  costoPromedio: string | null;
  valor: string | null;
  minimo: string | null;
  maximo: string | null;
  estado: EstadoExistencia;
}

export interface KpisExistencias {
  articulos: number;
  valor: string;
  atencion: number;
  sinExistencia: number;
  sobreMaximo: number;
  sinLectura: number;
}

export interface AlmacenExistencias {
  sucursalId: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  /** Reloj del agente, ISO UTC. Nulo = nunca se ha leído. */
  capturadoAt: string | null;
  recibidaAt: string | null;
  atrasada: boolean;
}

export interface SucursalExistencias {
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
  almacenesLeidos: number;
}

export interface Existencias {
  kpis: KpisExistencias;
  filas: FilaExistencia[];
  almacenes: AlmacenExistencias[];
  sucursales: SucursalExistencias[];
}

// ---------------------------------------------------------------------------
// Movimientos, pólizas y kardex (F2-122): `GET /inventario/movimientos`,
// `GET /inventario/polizas/{id}` y `GET /inventario/kardex`
// ---------------------------------------------------------------------------

/** `TipoPolizaInventario` del API. `otro` = el lector no supo traducir el tipo de SR. */
export type TipoPolizaInventario =
  | 'inicial'
  | 'compra'
  | 'consumo'
  | 'merma'
  | 'traspaso_salida'
  | 'traspaso_entrada'
  | 'ajuste'
  | 'otro';

export interface PolizaResumen {
  id: string;
  folio: string;
  tipo: TipoPolizaInventario;
  /** Cancelada en SR: se muestra, pero no suma al kardex. */
  cancelada: boolean;
  referencia: string | null;
}

/** Cantidades (con signo, 3 decimales) y dinero como TEXTO decimal. */
export interface FilaMovimiento {
  id: string;
  poliza: PolizaResumen;
  renglon: number;
  /** ISO UTC; se presenta en la zona de la sucursal. */
  fecha: string;
  sucursalId: string;
  sucursal: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  cantidad: string;
  costoUnitario: string;
  importe: string;
}

export interface SucursalMovimientos {
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
  /** 0 = esa sucursal nunca mandó movimientos. */
  polizasRecibidas: number;
}

export interface AlmacenMovimientos {
  sucursalId: string;
  almacenOrigenSrId: string;
  almacen: string | null;
}

export interface Movimientos {
  movimientos: FilaMovimiento[];
  total: number;
  pagina: number;
  porPagina: number;
  sucursales: SucursalMovimientos[];
  almacenes: AlmacenMovimientos[];
}

export interface PartidaPoliza {
  renglon: number;
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  cantidad: string;
  costoUnitario: string;
  importe: string;
}

export interface PolizaDetalle {
  id: string;
  origenSrId: string;
  folio: string;
  tipo: TipoPolizaInventario;
  tipoSr: string | null;
  fecha: string;
  referencia: string | null;
  cancelada: boolean;
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  recibidaAt: string;
  partidas: PartidaPoliza[];
  importeTotal: string;
}

export interface FilaKardex extends FilaMovimiento {
  /** Saldo después de este movimiento (una fila cancelada repite el anterior). */
  saldo: string;
}

export interface Kardex {
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  polizasRecibidas: number;
  saldoInicial: string;
  movimientos: FilaKardex[];
  saldoFinal: string;
  entradas: string;
  salidas: string;
  /** Cuándo se leyó la última foto de existencias de ese almacén. Nulo = nunca. */
  corteExistencia: string | null;
  existencia: string | null;
  saldoAlCorte: string | null;
  diferencia: string | null;
  /** Nulo = sin movimientos recibidos o sin existencia leída: no hay con qué comparar. */
  cuadra: boolean | null;
}

// --- Conteos físicos (F2-123) ----------------------------------------------------

/** `EstadoConteo`. */
export type EstadoConteo = 'en_captura' | 'cerrado' | 'cancelado';

/** `EstadoRenglonConteo`. */
export type EstadoRenglonConteo = 'con_diferencia' | 'cuadra' | 'sin_contar' | 'sin_teorico';

/** `ConteoResumenDto`. */
export interface ConteoResumen {
  id: string;
  folio: number;
  sucursalId: string;
  sucursal: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  /** Nulo = todos los artículos. */
  grupoOrigenSrId: string | null;
  grupo: string | null;
  nota: string | null;
  estado: EstadoConteo;
  /** Corte de la foto de existencias congelada como teórico. */
  teoricoCapturadoAt: string;
  teoricoAtrasado: boolean;
  creadoAt: string;
  cerradoAt: string | null;
  canceladoAt: string | null;
  articulos: number;
  contados: number;
}

/** `AlmacenConteoDto`. */
export interface AlmacenConteo {
  sucursalId: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  /** Nulo = sin lectura: no se puede contar. */
  capturadoAt: string | null;
  atrasada: boolean;
}

/** `GrupoConteoDto`. */
export interface GrupoConteo {
  sucursalId: string;
  grupoOrigenSrId: string;
  grupo: string;
}

/** `ConteosDto`: respuesta de `GET /inventario/conteos`. */
export interface Conteos {
  conteos: ConteoResumen[];
  total: number;
  almacenes: AlmacenConteo[];
  grupos: GrupoConteo[];
  sucursales: Array<{ sucursalId: string; sucursal: string; zonaHoraria: string }>;
}

/** `PartidaConteoDto`. */
export interface PartidaConteo {
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  grupo: string | null;
  /** Nulo = no venía en la foto (sin teórico, no 0). */
  teorico: string | null;
  costoPromedio: Importe | null;
  /** Nulo = sin contar (no 0). */
  contado: string | null;
  estado: EstadoRenglonConteo;
  diferencia: string | null;
  importe: Importe | null;
  capturadoAt: string | null;
}

/** `TotalesConteoDto`. */
export interface TotalesConteo {
  articulos: number;
  contados: number;
  sinContar: number;
  sinTeorico: number;
  conDiferencia: number;
  sinValuar: number;
  faltante: Importe;
  sobrante: Importe;
  neto: Importe;
}

/** `ConteoDetalleDto`: `GET /inventario/conteos/{id}`, `POST …/cerrar` y `…/cancelar`. */
export interface ConteoDetalle {
  conteo: ConteoResumen;
  zonaHoraria: string;
  partidas: PartidaConteo[];
  totales: TotalesConteo;
}

/** `CapturaRespuestaDto`: `PUT /inventario/conteos/{id}/partidas`. */
export interface CapturaRespuesta {
  guardadas: Array<{ insumoOrigenSrId: string; contado: string | null }>;
}

// --- Traspasos (F2-124) --------------------------------------------------------------

/** `EstadoTraspaso`: el flujo del panel (enviado → recibido; cancelado sólo desde enviado). */
export type EstadoTraspaso = 'enviado' | 'recibido' | 'cancelado';

/** `EstadoConciliacionTraspaso`: contra SoftRestaurant. */
export type EstadoConciliacionTraspaso = 'conciliado' | 'pendiente_sr' | 'en_alerta' | 'cancelado';

/** `TraspasoResumenDto`. */
export interface TraspasoResumen {
  id: string;
  folio: number;
  sucursalId: string;
  sucursal: string;
  almacenOrigenSrId: string;
  almacenOrigen: string | null;
  sucursalDestinoId: string;
  sucursalDestino: string;
  almacenDestinoSrId: string;
  almacenDestino: string | null;
  nota: string | null;
  estado: EstadoTraspaso;
  conciliacion: EstadoConciliacionTraspaso;
  enviadoAt: string;
  recibidoAt: string | null;
  canceladoAt: string | null;
  conciliadoAt: string | null;
  articulos: number;
  conciliados: number;
}

export interface SucursalTraspaso {
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
}

export interface AlmacenTraspaso {
  sucursalId: string;
  almacenOrigenSrId: string;
  almacen: string | null;
}

/** `TraspasosDto`: `GET /inventario/traspasos`. */
export interface Traspasos {
  traspasos: TraspasoResumen[];
  total: number;
  umbralAlertaHoras: number;
  sucursales: SucursalTraspaso[];
  almacenes: AlmacenTraspaso[];
}

/** `EspejoDto`: el renglón de una póliza de SR que concilia un renglón del traspaso. */
export interface EspejoTraspaso {
  polizaId: string;
  folio: string;
  referencia: string | null;
  renglon: number;
  fecha: string;
}

/** `PartidaTraspasoDto`. */
export interface PartidaTraspaso {
  insumoOrigenSrId: string;
  insumo: string | null;
  clave: string | null;
  unidad: string | null;
  cantidad: string;
  costoUnitario: Importe | null;
  importe: Importe | null;
  salida: EspejoTraspaso | null;
  entrada: EspejoTraspaso | null;
}

/** `TraspasoDetalleDto`: `GET /inventario/traspasos/{id}`, `POST` y sus acciones. */
export interface TraspasoDetalle {
  traspaso: TraspasoResumen;
  zonaHoraria: string;
  partidas: PartidaTraspaso[];
  totales: { importe: Importe; sinCosto: number };
}

/** `PolizaTraspasoSrDto`. */
export interface PolizaTraspasoSr {
  polizaId: string;
  folio: string;
  tipo: 'traspaso_salida' | 'traspaso_entrada';
  sucursalId: string;
  sucursal: string;
  almacenOrigenSrId: string;
  almacen: string | null;
  fecha: string;
  cancelada: boolean;
  partidas: number;
}

/** `TraspasoSrDto`: un documento de traspaso de SR (sus pólizas de salida y entrada). */
export interface TraspasoSr {
  referencia: string | null;
  polizas: PolizaTraspasoSr[];
  traspasosPanel: Array<{ id: string; folio: number }>;
}

/** `TraspasosSrDto`: `GET /inventario/traspasos/sr`. */
export interface TraspasosSr {
  traspasos: TraspasoSr[];
  truncado: boolean;
  hayPolizas: boolean;
  sucursales: SucursalTraspaso[];
}

// ---------------------------------------------------------------------------
// F2-125 · Recetas y consumo teórico
// ---------------------------------------------------------------------------

/** `SucursalRecetasDto`. */
export interface SucursalRecetas {
  sucursalId: string;
  sucursal: string;
  /** 0 = el agente nunca mandó recetas de esta sucursal. */
  recetasRecibidas: number;
  /** false = el catálogo de productos nunca cerró una sincronización completa. */
  catalogoProductos: boolean;
}

/** `RenglonRecetaVistaDto`. */
export interface RenglonRecetaVista {
  insumoOrigenSrId: string;
  insumo: string | null;
  unidad: string | null;
  /** 4 decimales, por UNA unidad vendida. */
  cantidad: string;
  costo: Importe | null;
  importe: Importe | null;
}

/** `ProductoRecetaDto`. */
export interface ProductoReceta {
  sucursalId: string;
  productoOrigenSrId: string;
  clave: string | null;
  /** Nulo = receta de un producto que el espejo no tiene. */
  nombre: string | null;
  vigente: boolean;
  enCatalogo: boolean;
  precio: Importe | null;
  conReceta: boolean;
  renglones: RenglonRecetaVista[];
  costo: Importe | null;
  costoIncompleto: boolean;
  /** 1 decimal. */
  porcentajePrecio: string | null;
}

/** `RecetasDto`: `GET /inventario/recetas`. */
export interface Recetas {
  sucursales: SucursalRecetas[];
  productos: ProductoReceta[];
  total: number;
  truncado: boolean;
}

/** `SucursalConsumoDto`. */
export interface SucursalConsumo extends SucursalRecetas {
  /** 0 = nunca mandó pólizas: el real es nulo. */
  polizasRecibidas: number;
  calculada: boolean;
  productosExplotados: number;
}

/** `FilaConsumoDto`. Cantidades a 3 decimales; `porcentaje` a 1. */
export interface FilaConsumo {
  sucursalId: string;
  insumoOrigenSrId: string;
  insumo: string | null;
  unidad: string | null;
  teorico: string;
  real: string | null;
  consumo: string | null;
  merma: string | null;
  ajuste: string | null;
  variacion: string | null;
  porcentaje: string | null;
  sinTeorico: boolean;
  costo: Importe | null;
  importeTeorico: Importe | null;
  importeVariacion: Importe | null;
}

export type MotivoAparte = 'sin_receta' | 'sin_catalogo' | 'ambiguo';

/** `VendidoAparteDto`. */
export interface VendidoAparte {
  sucursalId: string;
  sucursal: string;
  producto: string;
  motivo: MotivoAparte;
  productoOrigenSrId: string | null;
  partidas: number;
  cantidad: string;
  importe: Importe;
}

/** `ConsumoTeoricoDto`: `GET /inventario/consumo-teorico`. */
export interface ConsumoTeorico {
  sucursales: SucursalConsumo[];
  filas: FilaConsumo[];
  aparte: VendidoAparte[];
}
