import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import { useAuth } from '../auth/contexto';
import { destinoSeguro } from '../auth/siguiente';
import { Isotipo, Logotipo } from '../marca/Marca';
import { BOTON_PRIMARIO, CAMPO } from './botones';
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
    // UI-05: el login vive sobre el morado de la marca (en los dos temas), con el ojo enorme y
    // apagado al fondo, como la landing. Nada de imágenes pesadas: el ojo es el SVG de 1.6 kB.
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-linear-160 from-hero-fin to-hero p-4 py-10">
      <Isotipo
        variante="oscuro"
        decorativo
        className="pointer-events-none absolute -right-40 -bottom-32 -z-10 h-[34rem] w-[34rem] opacity-[0.07] blur-[2px] sm:-right-24 sm:-bottom-24 sm:h-[44rem] sm:w-[44rem]"
      />
      {/* UI-02: la marca va sobre su morado (el logo arena), en los dos temas. */}
      <div className="flex flex-col items-center motion-safe:animate-aparecer">
        {/* LAND-01: el logo lleva a la landing. Un <a> normal, no el router: la landing no es
            parte de la SPA (Caddy la sirve aparte en /landing/). */}
        <a
          href="/landing"
          aria-label="Ir a la página de Yo Controlo"
          className="cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-arena"
        >
          <h1>
            <Logotipo variante="oscuro" className="h-12 sm:h-14" />
          </h1>
        </a>
        <p className="mt-3 text-center text-sm text-hero-tenue">
          Ventas y mesas de tus sucursales, en vivo.
        </p>
      </div>
      <form
        onSubmit={enviar}
        aria-busy={enviando}
        className="mt-8 w-full max-w-sm rounded-2xl border border-linea bg-superficie p-6 shadow-lg motion-safe:animate-aparecer motion-safe:[animation-delay:80ms] sm:p-8"
      >
        <p className="font-titulo text-lg font-semibold text-tinta">Entra a tu panel</p>
        <p className="mt-0.5 mb-5 text-sm text-tinta-suave">Con el correo que te dieron de alta.</p>
        {aviso && !error && (
          <p role="status" className="mb-4 rounded-lg bg-aviso-fondo p-2.5 text-sm text-aviso">
            {aviso}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-peligro-fondo p-2.5 text-sm text-peligro">
            {error}
          </p>
        )}

        <label className="block text-sm font-medium text-tinta-medio" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${CAMPO} mt-1.5 py-2.5`}
        />

        <label className="mt-4 block text-sm font-medium text-tinta-medio" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${CAMPO} mt-1.5 py-2.5`}
        />

        <button
          type="submit"
          disabled={enviando}
          // El primario de siempre; lo propio del Login (ancho completo, más alto, sin borde, su
          // sombra y su opacidad al enviar) va con `!` para ganarle a la clase base sin depender
          // del orden de la hoja de estilos.
          className={`${BOTON_PRIMARIO} mt-6 w-full border-0! py-2.5! shadow-sm! disabled:opacity-60!`}
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-hero-tenue">
        ¿Sin acceso? Pídeselo al administrador de tu empresa.
      </p>
    </main>
  );
}
