import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ErrorApi } from '../../api/cliente';
import { Isotipo } from '../../marca/Marca';

/** Un icono de lucide: decorativo, el título ya lo nombra. */
export type Icono = LucideIcon;

/**
 * UI-05 (v3): la superficie de una tarjeta, en UN lugar. Borde suave, radio grande, el filo de
 * luz arriba y una sombra larga y difusa (`shadow-tarjeta`, ver index.css). La usan las
 * tarjetas de todo el panel, así que cambiar aquí cambia todas.
 */
export const SUPERFICIE_TARJETA =
  'rounded-2xl border border-linea-suave bg-superficie shadow-tarjeta';

export function Tarjeta({
  titulo,
  children,
  className = '',
  icono: IconoTitulo,
  accion,
  iconoEnCelular = true,
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
  /** Icono junto al título (UI-05). Decorativo. */
  icono?: Icono;
  /** Algo a la derecha del título: una liga, un estado ("En vivo"). */
  accion?: ReactNode;
  /** En rejillas de dos columnas en el celular, el icono le quita al título su renglón. */
  iconoEnCelular?: boolean;
}) {
  return (
    <section
      aria-label={titulo}
      className={`min-w-0 ${SUPERFICIE_TARJETA} p-4 md:p-5 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {IconoTitulo && (
          <span
            aria-hidden="true"
            className={`${iconoEnCelular ? 'flex' : 'hidden sm:flex'} h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-realce text-acento-texto`}
          >
            <IconoTitulo aria-hidden="true" className="h-4 w-4" />
          </span>
        )}
        <h2 className="min-w-0 flex-1 font-sans text-sm font-medium text-tinta-suave">{titulo}</h2>
        {accion}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/**
 * Un bloque del esqueleto: el color de la superficie de realce con un destello que la recorre
 * (sólo con movimiento permitido; quieto, es un bloque liso).
 */
export const BLOQUE_ESQUELETO =
  'rounded-md bg-realce bg-linear-to-r from-realce via-realce-fuerte to-realce bg-size-[200%_100%] motion-safe:animate-destello';

/** El mismo bloque dentro del hero morado: un velo claro que late (UI-05). */
const BLOQUE_ESQUELETO_HERO = 'rounded-md bg-hero-tinta/10 motion-safe:animate-pulse';

/**
 * Dónde va el contenido: en una tarjeta normal o dentro del hero morado del Inicio, que tiene
 * su propia tinta (los colores de texto del tema no pasan contraste sobre el morado en claro).
 */
export type Tono = 'normal' | 'hero';

/** Placeholder mientras carga: bloques del tamaño aproximado del contenido. */
export function Esqueleto({
  lineas = 2,
  grafica = false,
  tono = 'normal',
}: {
  lineas?: number;
  grafica?: boolean;
  tono?: Tono;
}) {
  const bloque = tono === 'hero' ? BLOQUE_ESQUELETO_HERO : BLOQUE_ESQUELETO;
  return (
    <div aria-busy="true" aria-label="Cargando" data-testid="esqueleto">
      <div className={`h-8 w-40 ${bloque}`} />
      {Array.from({ length: lineas }, (_, i) => (
        <div key={i} className={`mt-2.5 h-3.5 ${i % 2 === 0 ? 'w-32' : 'w-24'} ${bloque}`} />
      ))}
      {grafica && <div className={`mt-5 h-48 w-full rounded-xl ${bloque}`} />}
    </div>
  );
}

/**
 * Esqueleto de una lista o tabla (UI-05): renglones con la forma de una fila real (un dato
 * principal, dos secundarios y un importe a la derecha), dentro de una superficie de tarjeta.
 */
export function EsqueletoFilas({ filas = 6 }: { filas?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Cargando"
      data-testid="esqueleto"
      className={`divide-y divide-linea-suave overflow-hidden ${SUPERFICIE_TARJETA}`}
    >
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className={`h-4 w-14 ${BLOQUE_ESQUELETO}`} />
          <div className={`h-3.5 ${i % 3 === 0 ? 'w-40' : 'w-28'} ${BLOQUE_ESQUELETO}`} />
          <div className={`hidden h-3.5 w-24 sm:block ${BLOQUE_ESQUELETO}`} />
          <div className={`ml-auto h-4 w-20 ${BLOQUE_ESQUELETO}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * El ojo de la marca, apagado, para los estados vacíos (UI-05). Decorativo: el mensaje es el
 * que dice qué pasa.
 */
export function OjoVacio({
  className = 'h-9 w-9',
  tono = 'normal',
}: {
  className?: string;
  tono?: Tono;
}) {
  return (
    <Isotipo
      variante={tono === 'hero' ? 'oscuro' : 'auto'}
      className={`mx-auto opacity-40 ${className}`}
      decorativo
    />
  );
}

export function Vacio({ children, tono = 'normal' }: { children: ReactNode; tono?: Tono }) {
  return (
    <div className="flex flex-col items-center gap-2 py-5 text-center">
      <OjoVacio className="h-7 w-7" tono={tono} />
      <p className={`max-w-xs text-sm ${tono === 'hero' ? 'text-hero-tenue' : 'text-tinta-tenue'}`}>
        {children}
      </p>
    </div>
  );
}

/**
 * Estado vacío de una vista entera (UI-05): el ojo grande, qué pasa y, si se puede, qué hacer.
 */
export function EstadoVacio({
  titulo,
  children,
  testId,
}: {
  titulo: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center rounded-2xl border border-dashed border-linea-fuerte bg-superficie/60 px-6 py-10 text-center"
    >
      <OjoVacio className="h-14 w-14" />
      <p className="mt-4 font-titulo text-base font-semibold text-tinta">{titulo}</p>
      {children && <div className="mt-1 max-w-md text-sm text-tinta-suave">{children}</div>}
    </div>
  );
}

export function ErrorTarjeta({ error, tono = 'normal' }: { error: unknown; tono?: Tono }) {
  const detalle = error instanceof ErrorApi ? error.message : 'Error inesperado.';
  return (
    <p
      role="alert"
      className={`py-6 text-center text-sm ${tono === 'hero' ? 'text-hero-baja' : 'text-peligro'}`}
    >
      No se pudo cargar este dato. {detalle}
    </p>
  );
}

/** Estado de una consulta de TanStack en su forma mínima. */
interface EstadoConsulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

/**
 * Pinta skeleton, error o el contenido. Si una de las consultas falla, esa tarjeta
 * muestra el error y las demás siguen: una tarjeta rota no tumba el panel.
 */
export function SegunEstado<T>({
  consulta,
  esqueleto,
  children,
  tono,
}: {
  consulta: EstadoConsulta<T>;
  esqueleto: ReactNode;
  children: (datos: T) => ReactNode;
  tono?: Tono;
}) {
  if (consulta.isError) return <ErrorTarjeta error={consulta.error} tono={tono} />;
  if (consulta.isPending || consulta.data === undefined) return <>{esqueleto}</>;
  return <>{children(consulta.data)}</>;
}
