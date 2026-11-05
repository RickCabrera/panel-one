import { useTema } from './contexto';
import type { Estilo } from './paleta';

const OPCIONES: { valor: Estilo; nombre: string; corto: string; muestra: string }[] = [
  { valor: 'noche', nombre: 'Estilo Noche', corto: 'Noche', muestra: 'bg-muestra-noche' },
  { valor: 'clasico', nombre: 'Estilo Clásico', corto: 'Clásico', muestra: 'bg-muestra-clasico' },
];

/**
 * UI-06: el estilo de la marca, junto al interruptor de tema (en la cabecera y en «Más»). Cada
 * opción es una muestra de su color (negro o morado) con el punto violeta del acento; en la hoja
 * del celular (`amplio`) lleva además su nombre y 44 px de alto. El nombre accesible siempre es
 * «Estilo Noche» / «Estilo Clásico».
 */
export function InterruptorEstilo({ amplio = false }: { amplio?: boolean }) {
  const { estilo, elegirEstilo } = useTema();
  return (
    <div
      role="group"
      aria-label="Estilo"
      className="flex shrink-0 gap-0.5 rounded-lg bg-realce p-0.5"
    >
      {OPCIONES.map(({ valor, nombre, corto, muestra }) => {
        const activo = valor === estilo;
        return (
          <button
            key={valor}
            type="button"
            aria-label={nombre}
            aria-pressed={activo}
            title={nombre}
            onClick={() => elegirEstilo(valor)}
            className={`flex items-center gap-2 rounded-md ${amplio ? 'h-11 px-3 text-sm font-medium' : 'p-1'} ${activo ? 'bg-superficie text-tinta shadow-xs ring-1 ring-acento-borde ring-inset' : 'text-tinta-suave hover:text-tinta'}`}
          >
            <span
              aria-hidden="true"
              className={`relative flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-linea-fuerte ${muestra}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-acento" />
            </span>
            {amplio && <span aria-hidden="true">{corto}</span>}
          </button>
        );
      })}
    </div>
  );
}
