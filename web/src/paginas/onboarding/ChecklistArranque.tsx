import { CheckCircle2, Circle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import type { ClavePasoArranque, PasoArranque } from '../../api/tipos';
import { queryVista } from '../../filtros/vista';
import { useArranque } from '../admin/consultas';

/** A dónde ir para resolver cada paso. Ventas no tiene: llega sola cuando el agente lee. */
const DESTINO: Partial<Record<ClavePasoArranque, { tab?: string; ruta: string; texto: string }>> = {
  sucursales: { ruta: '/admin', tab: 'sucursales', texto: 'Ir a Sucursales' },
  llaves: { ruta: '/admin', tab: 'sucursales', texto: 'Generar keys en Sucursales' },
  agente: { ruta: '/ayuda/agente', texto: 'Ver la guía de instalación' },
  usuario: { ruta: '/admin', tab: 'usuarios', texto: 'Ir a Usuarios' },
};

function Paso({ paso, search }: { paso: PasoArranque; search: string }) {
  const destino = paso.hecho ? undefined : DESTINO[paso.clave];
  let buscar = search;
  if (destino?.tab) {
    const p = new URLSearchParams(search);
    p.set('tab', destino.tab);
    buscar = `?${p.toString()}`;
  }
  return (
    <li className="flex gap-2" aria-label={`${paso.titulo}: ${paso.hecho ? 'hecho' : 'pendiente'}`}>
      {paso.hecho ? (
        <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-exito" />
      ) : (
        <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-tinta-tenue" />
      )}
      <div className="min-w-0">
        <p className={paso.hecho ? 'text-tinta-medio' : 'font-medium'}>{paso.titulo}</p>
        <p className="text-tinta-tenue">{paso.detalle}</p>
        {paso.pendientes.length > 0 && (
          <p className="break-words text-tinta-tenue">
            Falta en: {paso.pendientes.map((s) => s.nombre).join(', ')}
          </p>
        )}
        {destino && (
          <Link
            to={{ pathname: destino.ruta, search: buscar }}
            className="text-acento-texto underline underline-offset-2"
          >
            {destino.texto}
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * La lista de arranque de una empresa (F2-147): qué falta para que el panel reciba sus datos.
 * En Inicio se muestra sólo mientras falte algo (`soloIncompleta`); el asistente de alta la
 * muestra siempre. Se calcula en el api con lo que ya hay, así que se marca sola.
 */
export function ChecklistArranque({
  empresaId,
  soloIncompleta = false,
}: {
  empresaId: string;
  soloIncompleta?: boolean;
}) {
  const [parametros] = useSearchParams();
  const consulta = useArranque(empresaId);

  if (consulta.isPending) {
    return soloIncompleta ? null : (
      <p className="text-sm text-tinta-tenue">Revisando qué le falta a la empresa…</p>
    );
  }
  if (consulta.isError) {
    return (
      <p role="alert" className="text-sm text-peligro">
        No se pudo revisar la lista de arranque de la empresa.
      </p>
    );
  }
  const arranque = consulta.data;
  if (soloIncompleta && arranque.completo) return null;

  const hechos = arranque.pasos.filter((p) => p.hecho).length;
  const search = queryVista(parametros);
  return (
    <section
      aria-label="Lista de arranque"
      className="rounded-lg border border-acento-borde bg-superficie p-4 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {arranque.completo ? 'La empresa está lista' : 'Para empezar a recibir datos'}
        </h2>
        <span className="text-tinta-tenue">
          {hechos} de {arranque.pasos.length} pasos
        </span>
      </div>
      <ol className="mt-3 space-y-3">
        {arranque.pasos.map((p) => (
          <Paso key={p.clave} paso={p} search={search} />
        ))}
      </ol>
      <p className="mt-3 text-tinta-tenue">
        {arranque.descargaAgente ? (
          <a
            href={arranque.descargaAgente}
            className="text-acento-texto underline underline-offset-2"
            rel="noopener noreferrer"
          >
            Descargar el instalador del agente
          </a>
        ) : (
          'El servidor no tiene configurada la descarga del instalador del agente: pídelo a soporte.'
        )}
      </p>
    </section>
  );
}
