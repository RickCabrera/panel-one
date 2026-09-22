import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { pedir } from '../../api/cliente';
import type {
  GuardarSuscripcionReporte,
  SuscripcionReporte,
  TipoReporte,
  VistaPreviaReporte,
} from '../../api/tipos';
import { useUsuario } from '../../auth/contexto';
import { useAlcance } from '../../filtros/alcance';
import { CLASE_BOTON, CLASE_PRIMARIO } from '../admin/estilos';
import { NOMBRE_ESTADO_ENVIO, NOMBRE_REPORTE, periodoLegible } from './textos';

/**
 * Reportes por correo (F2-141), dentro de Mi cuenta: cada usuario decide si le llega el
 * resumen diario y/o el semanal de la empresa elegida en la cabecera. La hora (07:00) y la
 * zona las decide la API; aquí se dicen en palabras. "Ver un ejemplo" arma el correo de hoy
 * con las mismas cifras que el panel, sin mandar nada.
 */

export function ReportesCorreo() {
  const usuario = useUsuario();
  const { empresa, empresas } = useAlcance();
  const empresaId = empresa?.id;
  const clienteQuery = useQueryClient();
  const llave = ['cuenta', 'reportes', empresaId];

  const suscripcion = useQuery({
    queryKey: llave,
    queryFn: ({ signal }) =>
      pedir<SuscripcionReporte>('/cuenta/reportes', { query: { empresaId }, signal }),
    enabled: empresaId !== undefined,
  });

  // Lo que el usuario está editando, ENCIMA de lo guardado; sólo vale para su empresa.
  const [borrador, setBorrador] = useState<GuardarSuscripcionReporte | null>(null);
  const [guardado, setGuardado] = useState(false);
  const vigente = borrador !== null && borrador.empresaId === empresaId ? borrador : null;
  const diario = vigente?.diario ?? suscripcion.data?.diario ?? false;
  const semanal = vigente?.semanal ?? suscripcion.data?.semanal ?? false;
  function editar(cambio: Partial<Pick<GuardarSuscripcionReporte, 'diario' | 'semanal'>>) {
    if (!empresaId) return;
    setBorrador({ empresaId, diario, semanal, ...cambio });
    setGuardado(false);
  }

  const guardar = useMutation({
    mutationFn: (cuerpo: GuardarSuscripcionReporte) =>
      pedir<SuscripcionReporte>('/cuenta/reportes', { method: 'PUT', body: cuerpo }),
    onSuccess: (data) => {
      clienteQuery.setQueryData(['cuenta', 'reportes', data.empresaId], data);
      setBorrador(null);
      setGuardado(true);
    },
  });

  const [tipoPrevia, setTipoPrevia] = useState<TipoReporte | null>(null);
  const previa = useQuery({
    queryKey: ['cuenta', 'reportes', 'vista-previa', empresaId, tipoPrevia],
    queryFn: ({ signal }) =>
      pedir<VistaPreviaReporte>('/cuenta/reportes/vista-previa', {
        query: { empresaId, tipo: tipoPrevia },
        signal,
      }),
    enabled: empresaId !== undefined && tipoPrevia !== null,
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!empresaId) return;
    setGuardado(false);
    guardar.mutate({ empresaId, diario, semanal });
  }

  let cuerpo;
  if (empresaId === undefined) {
    cuerpo = (
      <p className="text-sm text-tinta-tenue">
        {empresas.isPending
          ? 'Cargando empresas…'
          : 'Elige una empresa en la cabecera para configurar sus reportes por correo.'}
      </p>
    );
  } else if (suscripcion.isPending) {
    cuerpo = <p className="text-sm text-tinta-tenue">Cargando tus reportes…</p>;
  } else if (suscripcion.isError) {
    cuerpo = (
      <p role="alert" className="text-sm text-peligro">
        No se pudo leer tu configuración de reportes: {suscripcion.error.message}
      </p>
    );
  } else {
    const s = suscripcion.data;
    const cambio = diario !== s.diario || semanal !== s.semanal;
    cuerpo = (
      <>
        <p className="text-sm text-tinta-suave">
          Llegan a <strong>{usuario.email}</strong> a las {s.horaEnvio}:00 (hora de {s.zonaHoraria})
          con las cifras de <strong>{empresa?.nombre}</strong>, las mismas que ves en el panel.
        </p>
        <form aria-label="Reportes por correo" onSubmit={enviar} className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={diario}
              onChange={(e) => editar({ diario: e.target.checked })}
            />
            <span>
              <span className="font-medium">{NOMBRE_REPORTE.diario}</span>
              <span className="block text-tinta-tenue">
                Todos los días: la venta de ayer por sucursal, el top 5 de productos y las alertas.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={semanal}
              onChange={(e) => editar({ semanal: e.target.checked })}
            />
            <span>
              <span className="font-medium">{NOMBRE_REPORTE.semanal}</span>
              <span className="block text-tinta-tenue">
                Los lunes: la semana pasada contra la anterior, por sucursal y por día.
              </span>
            </span>
          </label>
          {guardar.isError && (
            <p role="alert" className="text-sm text-peligro">
              No se guardó: {guardar.error.message}
            </p>
          )}
          {guardado && !cambio && (
            <p role="status" className="text-sm text-exito">
              Guardado.
            </p>
          )}
          <button type="submit" className={CLASE_PRIMARIO} disabled={!cambio || guardar.isPending}>
            Guardar
          </button>
        </form>

        <div className="mt-4">
          <h3 className="text-sm font-medium">Últimos envíos</h3>
          {s.ultimosEnvios.length === 0 ? (
            <p className="text-sm text-tinta-tenue">
              {s.diario || s.semanal
                ? `Todavía no sale ninguno: el primero llega a las ${s.horaEnvio}:00.`
                : 'No tienes reportes activos, así que no se ha enviado ninguno.'}
            </p>
          ) : (
            <ul data-testid="envios-reporte" className="mt-1 space-y-1 text-sm">
              {s.ultimosEnvios.map((envio) => (
                <li key={`${envio.tipo}-${envio.periodo}`}>
                  {NOMBRE_REPORTE[envio.tipo]} · {periodoLegible(envio.tipo, envio.periodo)} ·{' '}
                  {NOMBRE_ESTADO_ENVIO[envio.estado]}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium">Ver un ejemplo</h3>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['diario', 'semanal'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={CLASE_BOTON}
                aria-pressed={tipoPrevia === t}
                onClick={() => setTipoPrevia(t)}
              >
                {NOMBRE_REPORTE[t]}
              </button>
            ))}
          </div>
          {tipoPrevia !== null &&
            (previa.isPending ? (
              <p className="mt-2 text-sm text-tinta-tenue">Armando el correo…</p>
            ) : previa.isError ? (
              <p role="alert" className="mt-2 text-sm text-peligro">
                No se pudo armar el ejemplo: {previa.error.message}
              </p>
            ) : (
              <div className="mt-2">
                <p className="text-sm">
                  <span className="text-tinta-tenue">Asunto:</span> {previa.data.asunto}
                </p>
                {/* sandbox sin permisos: el HTML del correo no ejecuta nada ni navega. */}
                <iframe
                  title={`Ejemplo: ${previa.data.asunto}`}
                  sandbox=""
                  srcDoc={previa.data.html}
                  className="mt-2 h-[32rem] w-full rounded-md border border-linea-fuerte"
                />
              </div>
            ))}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="titulo-reportes-correo" className="mt-8 max-w-2xl">
      <h2 id="titulo-reportes-correo" className="font-medium">
        Reportes por correo
      </h2>
      <div className="mt-2">{cuerpo}</div>
    </section>
  );
}
