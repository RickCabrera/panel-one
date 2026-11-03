import { Check, House } from 'lucide-react';
import { useState, type CSSProperties } from 'react';

import type { ColorAcento } from '../../api/tipos';
import { ACENTO_DESPLIEGUE, CLAVES_ACENTO, derivarAcento } from '../../tema/acento';
import { useTema } from '../../tema/contexto';
import { ACENTOS_PLATAFORMA } from '../../tema/paleta';
import { Cabecera, Cargando, ErrorCarga } from './Comunes';
import { apiPlataforma, useAccionPlataforma, useAjustes } from './consultas';
import { C } from './estilos';

/**
 * Ajustes que valen para TODOS los clientes (como en Tocadiscos). Hoy: el color de la
 * interfaz. Se guarda la CLAVE en la API; cada página lo toma al cargar (`GET /sistema`), y
 * ésta lo aplica en cuanto guarda.
 */
export function Ajustes() {
  const ajustes = useAjustes();

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Ajustes"
        subtitulo="Valen para todos los clientes. Los negocios no pueden cambiarlos."
      />
      {ajustes.isPending ? (
        <Cargando que="los ajustes" />
      ) : ajustes.isError ? (
        <ErrorCarga que="los ajustes" />
      ) : (
        <ColorInterfaz guardado={ajustes.data.colorAcento} />
      )}
    </div>
  );
}

function ColorInterfaz({ guardado }: { guardado: ColorAcento | null }) {
  const { tema } = useTema();
  const accion = useAccionPlataforma();
  const [elegido, setElegido] = useState<ColorAcento | null>(guardado);
  const [listo, setListo] = useState(false);
  const hex = elegido ? ACENTOS_PLATAFORMA[elegido].hex : ACENTO_DESPLIEGUE;
  // La vista previa redefine los tokens del acento SÓLO dentro de su recuadro.
  const variables = Object.fromEntries(
    Object.entries(derivarAcento(hex, tema)).map(([token, valor]) => [`--${token}`, valor]),
  ) as CSSProperties;

  async function guardar(color: ColorAcento | null) {
    setListo(false);
    const r = await accion.correr(() => apiPlataforma.guardarAjustes(color), { sistema: true });
    if (r.ok) {
      setElegido(r.valor.colorAcento);
      setListo(true);
    }
  }

  return (
    <section aria-label="Color de la interfaz" className="space-y-3">
      <h2 className={C.seccion}>Color de la interfaz</h2>
      <div className={`${C.tarjetaPad} space-y-4`}>
        <p className="text-sm text-tinta-suave">
          Es el color de los botones principales, del elemento activo del menú, de los enlaces y los
          interruptores, en el panel, el login y esta administración. Los colores de estado (verde
          de «al corriente», rojo de los errores) no cambian.
        </p>
        <fieldset>
          <legend className={C.etiqueta}>Color</legend>
          <div role="radiogroup" aria-label="Color" className="mt-2 flex flex-wrap gap-2">
            {CLAVES_ACENTO.map((clave) => {
              const activo = clave === elegido;
              return (
                <button
                  key={clave}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => setElegido(clave)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    activo ? 'border-tinta' : 'border-linea hover:bg-realce'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: ACENTOS_PLATAFORMA[clave].hex }}
                  >
                    {activo && <Check className="h-4 w-4 text-sobre-acento" />}
                  </span>
                  {ACENTOS_PLATAFORMA[clave].nombre}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <p className={C.etiqueta}>Vista previa</p>
          <div
            data-testid="vista-previa"
            style={variables}
            className="mt-2 flex flex-wrap items-center gap-4 rounded-lg border border-linea p-4"
          >
            <span className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-sobre-acento">
              Guardar cambios
            </span>
            <span className="flex items-center gap-2 rounded-lg bg-acento px-3 py-2 text-sm font-semibold text-sobre-acento">
              <House aria-hidden="true" className="h-4 w-4" /> Inicio
            </span>
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className="relative h-6 w-11 rounded-full bg-acento">
                <span className="absolute top-0.5 left-[22px] h-5 w-5 rounded-full bg-superficie" />
              </span>
              Encendido
            </span>
            <span className="text-sm text-acento-texto underline">Un enlace</span>
          </div>
        </div>

        <button
          type="button"
          className={`${C.primario} w-full`}
          disabled={accion.enCurso || elegido === guardado}
          onClick={() => void guardar(elegido)}
        >
          Guardar color
        </button>
        {guardado !== null && (
          <button
            type="button"
            className={`${C.secundario} w-full`}
            disabled={accion.enCurso}
            onClick={() => void guardar(null)}
          >
            Volver al color de fábrica
          </button>
        )}
        {accion.error && (
          <p role="alert" className={C.error}>
            {accion.error}
          </p>
        )}
        {listo && (
          <p role="status" className={C.exito}>
            Color guardado.
          </p>
        )}
        <p className="text-xs text-tinta-tenue">
          Aquí lo ves aplicado en cuanto guardas. Las páginas que ya estén abiertas en otros equipos
          lo toman al recargar.
        </p>
      </div>
    </section>
  );
}
