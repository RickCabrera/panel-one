import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTema } from './contexto';
import type { PreferenciaTema } from './tema';

const OPCIONES: { valor: PreferenciaTema; nombre: string; Icono: LucideIcon }[] = [
  { valor: 'claro', nombre: 'Tema claro', Icono: Sun },
  { valor: 'oscuro', nombre: 'Tema oscuro', Icono: Moon },
  { valor: 'sistema', nombre: 'Tema del sistema', Icono: Monitor },
];

/** Claro / oscuro / sistema, en la cabecera (F2-211). Sólo iconos: cabe a 390 px. */
export function InterruptorTema({ amplio = false }: { amplio?: boolean }) {
  const { preferencia, elegir } = useTema();
  return (
    <div
      role="group"
      aria-label="Tema"
      className="flex shrink-0 gap-0.5 rounded-lg bg-realce p-0.5"
    >
      {OPCIONES.map(({ valor, nombre, Icono }) => {
        const activo = valor === preferencia;
        return (
          <button
            key={valor}
            type="button"
            aria-label={nombre}
            aria-pressed={activo}
            title={nombre}
            onClick={() => elegir(valor)}
            // UI-04: en la hoja «Más» del celular, cada botón da 44 px de área táctil.
            className={`rounded-md ${amplio ? 'flex h-11 w-11 items-center justify-center' : 'p-1'} ${activo ? 'bg-acento text-sobre-acento shadow-xs ring-1 ring-acento-borde ring-inset' : 'text-tinta-suave hover:text-tinta'}`}
          >
            <Icono aria-hidden="true" className={amplio ? 'h-5 w-5' : 'h-4 w-4'} />
          </button>
        );
      })}
    </div>
  );
}
