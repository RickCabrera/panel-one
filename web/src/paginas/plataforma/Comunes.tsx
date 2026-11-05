import type { ReactNode } from 'react';

import type { EstadoMembresia, EstadoPagoMes } from '../../api/tipos';
import { Isotipo } from '../../marca/Marca';
import { CHIP_ESTADO, CHIP_PAGO, C } from './estilos';
import { TEXTO_ESTADO, TEXTO_PAGO } from './formato';

export function Chip({ clase, children }: { clase: string; children: ReactNode }) {
  return <span className={`${C.chip} ${clase}`}>{children}</span>;
}

export function ChipEstado({ estado }: { estado: EstadoMembresia | 'sin_suscripcion' }) {
  return <Chip clase={CHIP_ESTADO[estado]}>{TEXTO_ESTADO[estado]}</Chip>;
}

export function ChipPago({ estado }: { estado: EstadoPagoMes }) {
  return <Chip clase={CHIP_PAGO[estado]}>{TEXTO_PAGO[estado]}</Chip>;
}

export function Cabecera({
  titulo,
  subtitulo,
  accion,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <header className={C.cabecera}>
      <div className="min-w-0">
        <h1 className={C.titulo}>{titulo}</h1>
        {subtitulo && <p className={C.subtitulo}>{subtitulo}</p>}
      </div>
      {accion}
    </header>
  );
}

export function Cargando({ que }: { que: string }) {
  return <p className="text-sm text-tinta-tenue">Cargando {que}…</p>;
}

export function ErrorCarga({ que }: { que: string }) {
  return (
    <p role="alert" className={C.error}>
      No se pudo cargar {que}.
    </p>
  );
}

export function Tarjeta({
  valor,
  etiqueta,
  destacada = false,
}: {
  valor: ReactNode;
  etiqueta: string;
  /** UI-05: la cifra principal del tablero, sobre el morado de la marca (como el hero del Inicio). */
  destacada?: boolean;
}) {
  if (destacada) {
    return (
      <div className="relative isolate overflow-hidden rounded-2xl border border-hero-borde bg-linear-135 from-hero to-hero-fin p-4 text-hero-tinta shadow-hero vidrio-hero sm:p-5">
        <Isotipo
          variante="oscuro"
          decorativo
          className="pointer-events-none absolute -top-8 -right-8 -z-10 h-40 w-40 opacity-[0.08]"
        />
        <div className={`${C.numero} text-hero-cifra`}>{valor}</div>
        <div className="mt-1 text-sm text-hero-tenue">{etiqueta}</div>
      </div>
    );
  }
  return (
    <div className={C.tarjetaPad}>
      <div className={C.numero}>{valor}</div>
      <div className="mt-1 text-sm text-tinta-suave">{etiqueta}</div>
    </div>
  );
}
