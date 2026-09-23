import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { pedir } from '../../api/cliente';
import type {
  NotificacionesCuenta,
  PreferenciasPush,
  ResultadoPruebaPush,
  TipoNotificacion,
} from '../../api/tipos';
import {
  activarEnEsteDispositivo,
  desactivarEnEsteDispositivo,
  estadoDispositivo,
  type EstadoDispositivo,
} from '../../pwa/push';
import { CLASE_BOTON, CLASE_PRIMARIO } from '../admin/estilos';
import { AVISO_DISPOSITIVO, COLUMNA_NOTIFICACION, TEXTO_NOTIFICACION } from './textos';

/**
 * Notificaciones push (F2-146), dentro de Mi cuenta:
 * - **Este dispositivo**: activarlas/desactivarlas en ESTE navegador (pide permiso y lo
 *   registra en el api) y mandar una prueba. Si no se puede, dice por qué y qué hacer.
 * - **Qué avisos**: un interruptor por aviso, del usuario, que vale en todos sus navegadores.
 *   Cada uno se guarda al moverlo (se apagan por separado).
 */
const LLAVE_NOTIFICACIONES = ['cuenta', 'notificaciones'] as const;

export function Notificaciones() {
  const clienteQuery = useQueryClient();
  const cuenta = useQuery({
    queryKey: LLAVE_NOTIFICACIONES,
    queryFn: ({ signal }) => pedir<NotificacionesCuenta>('/cuenta/notificaciones', { signal }),
  });

  const [dispositivo, setDispositivo] = useState<EstadoDispositivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    estadoDispositivo().then(
      (e) => vivo && setDispositivo(e),
      () => vivo && setDispositivo('sin-soporte'),
    );
    return () => {
      vivo = false;
    };
  }, []);

  const guardarVista = (data: NotificacionesCuenta) =>
    clienteQuery.setQueryData(LLAVE_NOTIFICACIONES, data);

  const preferencias = useMutation({
    mutationFn: (cuerpo: PreferenciasPush) =>
      pedir<NotificacionesCuenta>('/cuenta/notificaciones/preferencias', {
        method: 'PUT',
        body: cuerpo,
      }),
    onSuccess: guardarVista,
  });

  const activar = useMutation({
    mutationFn: (clave: string) => activarEnEsteDispositivo(clave),
    onMutate: () => {
      setError(null);
      setResultado(null);
    },
    onSuccess: (data) => {
      guardarVista(data);
      setDispositivo('activo');
    },
    onError: (e) => {
      setError(e.message);
      void estadoDispositivo().then(setDispositivo);
    },
  });

  const desactivar = useMutation({
    mutationFn: desactivarEnEsteDispositivo,
    onMutate: () => {
      setError(null);
      setResultado(null);
    },
    onSuccess: () => {
      setDispositivo('inactivo');
      void clienteQuery.invalidateQueries({ queryKey: LLAVE_NOTIFICACIONES });
    },
    onError: (e) => setError(e.message),
  });

  const prueba = useMutation({
    mutationFn: () =>
      pedir<ResultadoPruebaPush>('/cuenta/notificaciones/prueba', { method: 'POST' }),
    onMutate: () => {
      setError(null);
      setResultado(null);
    },
    onSuccess: (r) => {
      setResultado(
        r.entregados > 0
          ? `Enviada a ${r.entregados} ${r.entregados === 1 ? 'dispositivo' : 'dispositivos'}. Debe aparecer en unos segundos.`
          : 'No se entregó a ningún dispositivo. Desactiva y vuelve a activar las notificaciones aquí.',
      );
      void clienteQuery.invalidateQueries({ queryKey: LLAVE_NOTIFICACIONES });
    },
    onError: (e) => setError(e.message),
  });

  let cuerpo;
  if (cuenta.isPending) {
    cuerpo = <p className="text-sm text-tinta-tenue">Cargando tus notificaciones…</p>;
  } else if (cuenta.isError) {
    cuerpo = (
      <p role="alert" className="text-sm text-peligro">
        No se pudo leer tu configuración de notificaciones: {cuenta.error.message}
      </p>
    );
  } else {
    const c = cuenta.data;
    const ocupado = activar.isPending || desactivar.isPending;
    const cambiar = (tipo: TipoNotificacion, valor: boolean) =>
      preferencias.mutate({ ...c.preferencias, [COLUMNA_NOTIFICACION[tipo]]: valor });

    let esteDispositivo;
    if (c.clavePublica === null) {
      esteDispositivo = <p className="text-sm text-tinta-tenue">{AVISO_DISPOSITIVO.sinClave}</p>;
    } else if (dispositivo === null) {
      esteDispositivo = <p className="text-sm text-tinta-tenue">Revisando este navegador…</p>;
    } else if (dispositivo === 'activo') {
      esteDispositivo = (
        <>
          <p className="text-sm text-exito">{AVISO_DISPOSITIVO.activo}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={CLASE_BOTON}
              disabled={prueba.isPending}
              onClick={() => prueba.mutate()}
            >
              Enviar prueba
            </button>
            <button
              type="button"
              className={CLASE_BOTON}
              disabled={ocupado}
              onClick={() => desactivar.mutate()}
            >
              Desactivar en este dispositivo
            </button>
          </div>
        </>
      );
    } else if (dispositivo === 'inactivo') {
      const clave = c.clavePublica;
      esteDispositivo = (
        <>
          <p className="text-sm text-tinta-suave">{AVISO_DISPOSITIVO.inactivo}</p>
          <button
            type="button"
            className={`${CLASE_PRIMARIO} mt-2`}
            disabled={ocupado}
            onClick={() => activar.mutate(clave)}
          >
            Activar en este dispositivo
          </button>
        </>
      );
    } else {
      esteDispositivo = (
        <p role="status" className="text-sm text-tinta-suave">
          {AVISO_DISPOSITIVO[dispositivo]}
        </p>
      );
    }

    cuerpo = (
      <>
        <div data-testid="notificaciones-dispositivo">
          <h3 className="text-sm font-medium">Este dispositivo</h3>
          <div className="mt-1">{esteDispositivo}</div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-peligro">
              {error}
            </p>
          )}
          {resultado && (
            <p role="status" className="mt-2 text-sm text-tinta-suave">
              {resultado}
            </p>
          )}
        </div>

        <fieldset className="mt-4" disabled={preferencias.isPending}>
          <legend className="text-sm font-medium">Qué avisos quieres</legend>
          <p className="text-sm text-tinta-tenue">
            Valen en todos tus dispositivos
            {c.dispositivos > 0
              ? ` (tienes ${c.dispositivos} ${c.dispositivos === 1 ? 'registrado' : 'registrados'}).`
              : '; todavía no activas ninguno.'}{' '}
            Los límites de mesa y sucursal los fija el administrador de tu empresa.
          </p>
          <div className="mt-2 space-y-2">
            {c.disponibles.map((tipo) => (
              <label key={tipo} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={c.preferencias[COLUMNA_NOTIFICACION[tipo]]}
                  onChange={(e) => cambiar(tipo, e.target.checked)}
                />
                <span>
                  <span className="font-medium">{TEXTO_NOTIFICACION[tipo].nombre}</span>
                  <span className="block text-tinta-tenue">{TEXTO_NOTIFICACION[tipo].detalle}</span>
                </span>
              </label>
            ))}
          </div>
          {preferencias.isError && (
            <p role="alert" className="mt-2 text-sm text-peligro">
              No se guardó: {preferencias.error.message}
            </p>
          )}
        </fieldset>
      </>
    );
  }

  return (
    <section aria-labelledby="titulo-notificaciones" className="mt-8 max-w-2xl">
      <h2 id="titulo-notificaciones" className="font-medium">
        Notificaciones
      </h2>
      <div className="mt-2">{cuerpo}</div>
    </section>
  );
}
