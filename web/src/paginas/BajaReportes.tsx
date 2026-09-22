import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ErrorApi, pedir } from '../api/cliente';
import type { BajaReportes as RespuestaBaja, TipoReporte } from '../api/tipos';
import { Logo, NOMBRE_PRODUCTO } from '../marca/Marca';
import { CLASE_PRIMARIO } from './admin/estilos';

/**
 * Baja de los reportes por correo (F2-141), PÚBLICA: el enlace del correo abre esta página
 * sin sesión. No da de baja al cargar (los escáneres de correo abren los enlaces): pide
 * confirmar con un botón, y sólo entonces hace el POST con el token del enlace.
 *
 * El token viaja en la URL: la página pide `no-referrer` para que no salga en la cabecera
 * Referer de nada que se cargue desde aquí.
 */

const TEXTO_TIPO: Record<TipoReporte, string> = {
  diario: 'el resumen diario',
  semanal: 'el resumen semanal',
};

function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 404 || error.status === 400) {
      return 'Este enlace no es válido o ya no existe. Puedes cambiar tus reportes desde Mi cuenta.';
    }
    if (error.status === 429) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    if (error.status === 0) return 'No se pudo conectar con el servidor.';
  }
  return 'No se pudo completar la baja. Intenta de nuevo.';
}

export function BajaReportes() {
  const [parametros] = useSearchParams();
  const token = parametros.get('t') ?? '';
  const crudo = parametros.get('tipo');
  const tipo: TipoReporte | undefined =
    crudo === 'diario' || crudo === 'semanal' ? crudo : undefined;
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<RespuestaBaja | null>(null);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const que = tipo ? TEXTO_TIPO[tipo] : 'los reportes por correo';

  async function confirmar() {
    setEnCurso(true);
    setError(null);
    try {
      setListo(
        await pedir<RespuestaBaja>('/reportes/baja', {
          method: 'POST',
          body: tipo ? { token, tipo } : { token },
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnCurso(false);
    }
  }

  let cuerpo;
  if (!token) {
    cuerpo = (
      <p role="alert" className="text-sm text-peligro">
        El enlace está incompleto. Ábrelo tal cual viene en el correo, o cambia tus reportes desde
        Mi cuenta.
      </p>
    );
  } else if (listo) {
    cuerpo = (
      <p role="status" className="text-sm text-exito">
        Listo: ya no recibirás {que}.
        {(listo.diario || listo.semanal) &&
          ` Sigues recibiendo ${listo.diario ? TEXTO_TIPO.diario : TEXTO_TIPO.semanal}.`}{' '}
        Puedes volver a activarlo cuando quieras desde Mi cuenta.
      </p>
    );
  } else {
    cuerpo = (
      <>
        <p className="text-sm text-tinta-suave">¿Dejar de recibir {que}?</p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-peligro">
            {error}
          </p>
        )}
        <button
          type="button"
          className={`${CLASE_PRIMARIO} mt-4`}
          disabled={enCurso}
          onClick={() => void confirmar()}
        >
          Sí, dejar de recibirlo
        </button>
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-fondo p-4">
      <section className="w-full max-w-md rounded-lg border border-linea bg-superficie p-6">
        <div className="mb-4 flex items-center gap-2">
          <Logo />
          <span className="font-semibold">{NOMBRE_PRODUCTO}</span>
        </div>
        <h1 className="mb-2 text-lg font-semibold">Reportes por correo</h1>
        {cuerpo}
        <p className="mt-6 text-sm">
          <Link to="/cuenta" className="text-acento-texto underline">
            Ir a Mi cuenta
          </Link>
        </p>
      </section>
    </main>
  );
}
