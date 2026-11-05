import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/contexto';
import { destinoSeguro } from '../auth/siguiente';
import { Logotipo } from '../marca/Marca';
import { PantallaCarga } from './PantallaCarga';

function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 401) return 'Credenciales inválidas.';
    // Membresías: la cuenta de la empresa está suspendida o cancelada. La API manda el mensaje
    // ("Tu cuenta está suspendida. Contacta a soporte.") sólo con la contraseña correcta.
    if (error.status === 403 && error.message) return error.message;
    if (error.status === 429) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    if (error.status === 400) return 'Revisa el correo y la contraseña.';
    if (error.status === 0) return 'No se pudo conectar con el servidor.';
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

export function Login() {
  const { auth, iniciarSesion } = useAuth();
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const destino = destinoSeguro(parametros.get('siguiente'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (auth.estado === 'cargando') return <PantallaCarga />;
  if (auth.estado === 'autenticado' && !enviando) return <Navigate to={destino} replace />;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciarSesion(email.trim(), password);
      navegar(destino, { replace: true });
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  const aviso =
    auth.estado === 'anonimo' && auth.motivo === 'expirada'
      ? 'Tu sesión expiró. Vuelve a entrar.'
      : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-fondo p-4">
      <form
        onSubmit={enviar}
        aria-busy={enviando}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-linea bg-superficie shadow-lg"
      >
        {/* UI-02: la marca va sobre su morado (el logo arena), en los dos temas. */}
        <div className="flex flex-col items-center border-b border-lateral-borde bg-lateral px-6 pt-8 pb-6">
          {/* LAND-01: el logo lleva a la landing. Un <a> normal, no el router: la landing no es
              parte de la SPA (Caddy la sirve aparte en /landing/). */}
          <a
            href="/landing"
            aria-label="Ir a la página de Yo Controlo"
            className="cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-arena"
          >
            <h1>
              <Logotipo variante="oscuro" className="h-14" />
            </h1>
          </a>
          <p className="mt-3 text-center text-sm text-lateral-tenue">
            Ventas y mesas de tus sucursales, en vivo.
          </p>
        </div>
        <div className="p-6 sm:px-8">
          {aviso && !error && (
            <p role="status" className="mb-4 rounded-md bg-aviso-fondo p-2 text-sm text-aviso">
              {aviso}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-4 rounded-md bg-peligro-fondo p-2 text-sm text-peligro">
              {error}
            </p>
          )}

          <label className="block text-sm font-medium" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-linea-fuerte bg-superficie px-3 py-2 text-sm focus:border-acento-borde focus:outline-none focus:ring-2 focus:ring-acento-borde/30"
          />

          <label className="mt-3 block text-sm font-medium" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-linea-fuerte bg-superficie px-3 py-2 text-sm focus:border-acento-borde focus:outline-none focus:ring-2 focus:ring-acento-borde/30"
          />

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 w-full rounded-lg bg-acento px-3 py-2.5 text-sm font-semibold text-sobre-acento shadow-sm hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
      <p className="mt-6 text-center text-xs text-tinta-tenue">
        ¿Sin acceso? Pídeselo al administrador de tu empresa.
      </p>
    </main>
  );
}
