import { useEffect, useState } from 'react';

import type { CodigoEnlaceEmitido, Sucursal } from '../../api/tipos';
import { api, useAccion } from './consultas';
import { Dialogo } from './Dialogo';
import { CLASE_BOTON, CLASE_PRIMARIO } from './estilos';
import { formatoRestante, segundosRestantes, URL_INSTALADOR } from './reglasEnlace';

/**
 * "Conectar sucursal" (instalador de un clic): genera el código de enlace y explica los 3 pasos.
 * El código vive SÓLO en el estado de este diálogo (como la API key en `MostrarKey`): al cerrarlo
 * se pierde, y no pasa por la caché de TanStack. Sirve una vez y vence a los 30 minutos.
 *
 * Generarlo no corta al agente que ya estuviera instalado: la key se rota hasta que el instalador
 * canjea el código.
 */
export function ConectarSucursal({
  sucursal,
  onCerrar,
}: {
  sucursal: Sucursal;
  onCerrar: () => void;
}) {
  const accion = useAccion();
  const [emitido, setEmitido] = useState<CodigoEnlaceEmitido | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  async function generar() {
    const r = await accion.correr(() => api.emitirCodigoEnlace(sucursal.id));
    if (r.ok) {
      setEmitido(r.valor);
      setAhora(Date.now());
    }
  }

  useEffect(() => {
    if (!emitido) return;
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [emitido]);

  const restante = emitido ? segundosRestantes(emitido.expiraAt, ahora) : 0;
  const vencido = emitido !== null && restante === 0;

  return (
    <Dialogo
      titulo={`Conectar ${sucursal.nombre}`}
      onCerrar={onCerrar}
      // Con el código a la vista, sólo se cierra con su botón: nadie lo pierde sin querer.
      cerrable={emitido === null}
    >
      <div className="space-y-4 text-sm">
        {emitido === null ? (
          <>
            <p>
              Genera un <strong>código de enlace</strong> para instalar el agente en la PC donde
              está el SQL Server de SoftRestaurant. Es lo único que hay que escribir en esa PC.
            </p>
            <p className="text-tinta-tenue">
              Sirve una sola vez y vence en 30 minutos. Si esta sucursal ya tenía el agente, sigue
              funcionando hasta que se use el código; en ese momento su API key anterior deja de
              servir.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-linea p-4 text-center">
              <p className="text-tinta-suave">Código de enlace</p>
              <p
                className={`select-all font-mono text-4xl font-semibold tracking-widest ${vencido ? 'text-tinta-tenue line-through' : ''}`}
                data-testid="codigo-enlace"
              >
                {emitido.codigo}
              </p>
              {vencido ? (
                <p role="alert" className="mt-1 text-peligro">
                  Venció. Genera otro.
                </p>
              ) : (
                <p className="mt-1 text-tinta-medio" role="timer" aria-live="off">
                  Vence en <strong>{formatoRestante(restante)}</strong> · sirve una sola vez
                </p>
              )}
            </div>
            <ol className="list-decimal space-y-2 pl-5" aria-label="Pasos en la PC del restaurante">
              <li>
                <strong>Descarga el instalador</strong> en la PC donde está el SQL Server de
                SoftRestaurant
                {URL_INSTALADOR ? (
                  <>
                    {' '}
                    (
                    <a className="text-acento-texto underline" href={URL_INSTALADOR}>
                      Instalar-YoControlo.zip
                    </a>
                    )
                  </>
                ) : (
                  <> (pídele a soporte el archivo Instalar-YoControlo.zip)</>
                )}{' '}
                y extráelo: clic derecho › Extraer todo.
              </li>
              <li>
                <strong>Doble clic en Instalar-YoControlo</strong> y acepta cuando Windows pregunte
                si permites cambios.
              </li>
              <li>
                <strong>Escribe este código</strong> cuando lo pida. En unos minutos dice{' '}
                <em>LISTO</em> y la sucursal aparece como <em>Conectado</em> en Administración ›
                Agentes.
              </li>
            </ol>
          </>
        )}
        {accion.error && (
          <p role="alert" className="text-peligro">
            {accion.error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {emitido === null ? (
            <>
              <button type="button" className={CLASE_BOTON} onClick={onCerrar}>
                Cancelar
              </button>
              <button
                type="button"
                className={CLASE_PRIMARIO}
                disabled={accion.enCurso}
                onClick={() => void generar()}
              >
                Generar código
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={CLASE_BOTON}
                disabled={accion.enCurso}
                onClick={() => void generar()}
              >
                {vencido ? 'Generar otro' : 'Generar otro (anula éste)'}
              </button>
              <button type="button" className={CLASE_PRIMARIO} onClick={onCerrar}>
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
