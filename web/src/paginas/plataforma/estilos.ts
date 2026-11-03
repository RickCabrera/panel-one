import type { EstadoMembresia, EstadoPagoMes } from '../../api/tipos';

/**
 * El estilo del panel de plataforma, en UN solo lugar para poder reestilizarlo sin tocar las
 * pantallas (sigue el de Tocadiscos: tarjetas redondeadas, filas con chips de estado y botón
 * principal en el color de acento). Sólo tokens de la paleta (F2-211): nada de colores a mano.
 */
export const C = {
  pagina: 'mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-10',
  titulo: 'text-2xl font-bold tracking-tight sm:text-3xl',
  subtitulo: 'mt-1 text-sm text-tinta-suave',
  cabecera: 'flex flex-wrap items-start justify-between gap-3',
  tarjeta: 'rounded-xl border border-linea bg-superficie',
  tarjetaPad: 'rounded-xl border border-linea bg-superficie p-4 sm:p-5',
  lista: 'divide-y divide-linea rounded-xl border border-linea bg-superficie',
  fila: 'flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5',
  filaTitulo: 'font-semibold break-words',
  filaDetalle: 'text-sm text-tinta-suave',
  seccion: 'text-base font-semibold',
  etiqueta: 'block text-sm font-medium text-tinta-medio',
  input:
    'mt-1 w-full min-w-0 rounded-lg border border-linea-fuerte bg-superficie px-3 py-2 text-sm focus:border-acento-borde focus:outline-none',
  primario:
    'rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-sobre-acento hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde disabled:opacity-50',
  secundario:
    'rounded-lg border border-linea-fuerte px-4 py-2 text-sm font-medium text-tinta-medio hover:bg-realce disabled:opacity-50',
  peligro:
    'rounded-lg border border-peligro-borde px-4 py-2 text-sm font-medium text-peligro hover:bg-peligro-fondo disabled:opacity-50',
  chip: 'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold',
  numero: 'text-2xl font-bold tabular-nums',
  error: 'rounded-lg bg-peligro-fondo p-2 text-sm text-peligro',
  aviso: 'rounded-lg bg-aviso-fondo p-2 text-sm text-aviso',
  exito: 'rounded-lg bg-exito-fondo p-2 text-sm text-exito',
} as const;

const CHIP_NEUTRO = 'bg-realce text-tinta-suave';
const CHIP_EXITO = 'bg-exito-fondo text-exito';
const CHIP_AVISO = 'bg-aviso-fondo text-aviso';
const CHIP_PELIGRO = 'bg-peligro-fondo text-peligro';

export const CHIP_ESTADO: Record<EstadoMembresia | 'sin_suscripcion', string> = {
  activa: CHIP_EXITO,
  prueba: 'bg-realce text-acento-texto',
  vencida: CHIP_PELIGRO,
  suspendida: CHIP_AVISO,
  cancelada: CHIP_NEUTRO,
  sin_suscripcion: CHIP_NEUTRO,
};

export const CHIP_PAGO: Record<EstadoPagoMes, string> = {
  pagado: CHIP_EXITO,
  pendiente: CHIP_AVISO,
  vencido: CHIP_PELIGRO,
};

export const CHIP_NEUTRAL = CHIP_NEUTRO;
export const CHIP_ACTIVO = CHIP_EXITO;
