import { Link } from 'react-router';

export function NoEncontrada() {
  return (
    <section className="p-4 md:p-6">
      <h1 className="text-xl font-semibold">No encontrada</h1>
      <p className="mt-2 text-slate-600">La vista que buscas no existe.</p>
      <Link to="/" className="mt-4 inline-block font-medium text-acento underline">
        Ir al inicio
      </Link>
    </section>
  );
}
