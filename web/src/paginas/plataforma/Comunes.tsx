import type { ReactNode } from 'react';

import type { EstadoMembresia, EstadoPagoMes } from '../../api/tipos';
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

export function Tarjeta({ valor, etiqueta }: { valor: ReactNode; etiqueta: string }) {
  return (
    <div className={C.tarjetaPad}>
      <div className={C.numero}>{valor}</div>
      <div className="mt-1 text-sm text-tinta-suave">{etiqueta}</div>
    </div>
  );
}
