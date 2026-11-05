import { Isotipo } from '../marca/Marca';

export function PantallaCarga() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-sm text-tinta-tenue"
      role="status"
    >
      <Isotipo className="h-10 w-10 animate-pulse motion-reduce:animate-none" />
      Cargando…
    </div>
  );
}
