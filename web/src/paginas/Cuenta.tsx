import { useState, type FormEvent } from 'react';

import { ErrorApi, pedir } from '../api/cliente';
import { PASSWORD_MAX, PASSWORD_MIN, type CambiarPassword, type Sesion } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { NOMBRE_ROL } from '../auth/roles';
import { establecerSesion, esperarRefreshEnVuelo } from '../auth/sesion';
import { CLASE_INPUT, CLASE_PRIMARIO } from './admin/estilos';
import { ReportesCorreo } from './cuenta/ReportesCorreo';

/**
 * Mi cuenta (F1-060): cambio de contraseña propio, para CUALQUIER rol. Y (F2-141) los
 * reportes por correo del propio usuario (`cuenta/ReportesCorreo.tsx`). La API
 * devuelve una sesión nueva (y rota la cookie): los otros navegadores de este
 * usuario pierden su refresh, y éste sigue dentro sin volver a entrar.
 *
 * No pasa por TanStack Query ni guarda nada fuera del formulario: las contraseñas
 * se borran del estado en cuanto responde la API.
 */
export function Cuenta() {
  const usuario = useUsuario();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setListo(false);
    if (nueva !== confirmacion) {
      setError('La contraseña nueva y su confirmación no coinciden.');
      return;
    }
    setEnCurso(true);
    setError(null);
    try {
      await esperarRefreshEnVuelo();
      const cuerpo: CambiarPassword = { actual, nueva };
      const sesion = await pedir<Sesion>('/cuenta/password', { method: 'POST', body: cuerpo });
      establecerSesion(sesion);
      setListo(true);
    } catch (err) {
      setError(
        err instanceof ErrorApi && err.status === 429
          ? 'Demasiados intentos. Espera un minuto y vuelve a intentar.'
          : err instanceof Error
            ? err.message
            : 'Algo salió mal.',
      );
    } finally {
      setActual('');
      setNueva('');
      setConfirmacion('');
      setEnCurso(false);
    }
  }

  return (
    <section className="p-4 md:p-6">
      <h1 className="text-xl font-semibold">Mi cuenta</h1>
      <p className="mt-1 truncate text-sm text-tinta-suave">
        {usuario.email} · {NOMBRE_ROL[usuario.rol]}
      </p>
      <form
        aria-label="Cambiar contraseña"
        onSubmit={(e) => void enviar(e)}
        className="mt-6 max-w-md space-y-3"
      >
        <h2 className="font-medium">Cambiar contraseña</h2>
        <label className="block text-sm">
          <span className="text-tinta-suave">Contraseña actual</span>
          <input
            type="password"
            autoComplete="current-password"
            className={CLASE_INPUT}
            value={actual}
            required
            onChange={(e) => setActual(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-tinta-suave">Contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            className={CLASE_INPUT}
            value={nueva}
            required
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            onChange={(e) => setNueva(e.target.value)}
          />
          <span className="text-xs text-tinta-tenue">Mínimo {PASSWORD_MIN} caracteres.</span>
        </label>
        <label className="block text-sm">
          <span className="text-tinta-suave">Confirma la contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            className={CLASE_INPUT}
            value={confirmacion}
            required
            onChange={(e) => setConfirmacion(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
        {listo && (
          <p role="status" className="text-sm text-exito">
            Contraseña cambiada. Tus sesiones en otros navegadores se cerrarán en cuanto intenten
            renovarse.
          </p>
        )}
        <button type="submit" className={CLASE_PRIMARIO} disabled={enCurso}>
          Cambiar contraseña
        </button>
      </form>
      <ReportesCorreo />
    </section>
  );
}
