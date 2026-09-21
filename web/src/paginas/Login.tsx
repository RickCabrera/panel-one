import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/contexto';
import { destinoSeguro } from '../auth/siguiente';
import { PantallaCarga } from './PantallaCarga';

function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 401) return 'Credenciales inválidas.';
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={enviar}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-center text-xl font-semibold text-acento">Monitor SoftRestaurant</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Inicia sesión para continuar</p>

        {aviso && !error && (
          <p role="status" className="mt-4 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            {aviso}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mt-4 block text-sm font-medium" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-acento focus:outline-none"
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
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-acento focus:outline-none"
        />

        <button
          type="submit"
          disabled={enviando}
          className="mt-5 w-full rounded-md bg-acento px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
