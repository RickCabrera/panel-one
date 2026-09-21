import { Link } from 'react-router';

/**
 * 404 de la SPA. Sólo se ve con sesión: una ruta desconocida sin sesión manda al
 * login, así un anónimo no puede sondear qué vistas existen.
 */
export function NoEncontrada() {
  return (
    <section className="flex flex-col items-center p-8 text-center md:p-12">
      <p className="text-5xl font-bold text-acento" aria-hidden="true">
        404
      </p>
      <h1 className="mt-3 text-xl font-semibold">No encontrada</h1>
      <p className="mt-2 max-w-md text-slate-600">
        La vista que buscas no existe o no tienes acceso a ella. Revisa la dirección o vuelve al
        inicio.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-acento px-4 py-2 text-sm font-medium text-white hover:brightness-110"
      >
        Ir al inicio
      </Link>
    </section>
  );
}
