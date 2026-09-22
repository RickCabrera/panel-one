import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTema } from './contexto';
import type { PreferenciaTema } from './tema';

const OPCIONES: { valor: PreferenciaTema; nombre: string; Icono: LucideIcon }[] = [
  { valor: 'claro', nombre: 'Tema claro', Icono: Sun },
  { valor: 'oscuro', nombre: 'Tema oscuro', Icono: Moon },
  { valor: 'sistema', nombre: 'Tema del sistema', Icono: Monitor },
];

/** Claro / oscuro / sistema, en la cabecera (F2-211). Sólo iconos: cabe a 390 px. */
export function InterruptorTema() {
  const { preferencia, elegir } = useTema();
  return (
    <div
      role="group"
      aria-label="Tema"
      className="flex shrink-0 rounded-md border border-linea-fuerte p-0.5"
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
            className={`rounded p-1 ${activo ? 'bg-acento text-sobre-acento' : 'text-tinta-suave hover:bg-realce'}`}
          >
            <Icono aria-hidden="true" className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
