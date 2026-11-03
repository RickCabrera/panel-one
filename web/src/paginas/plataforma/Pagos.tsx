import { useState } from 'react';
import { Link } from 'react-router';

import type { EstadoPagoMes, Mensualidad } from '../../api/tipos';
import { pesos } from '../../dinero/dinero';
import { Cabecera, Cargando, Chip, ChipEstado, ChipPago, ErrorCarga, Tarjeta } from './Comunes';
import { usePagosDelMes } from './consultas';
import { C, CHIP_NEUTRAL } from './estilos';
import { fechaDia, mesLargo } from './formato';
import { RegistrarPago } from './RegistrarPago';

const PESTANAS: {
  valor: EstadoPagoMes | '';
  texto: string;
  conteo: 'todos' | 'pagados' | 'pendientes' | 'vencidos';
}[] = [
  { valor: '', texto: 'Todos', conteo: 'todos' },
  { valor: 'pagado', texto: 'Pagados', conteo: 'pagados' },
  { valor: 'pendiente', texto: 'Pendientes', conteo: 'pendientes' },
  { valor: 'vencido', texto: 'Vencidos', conteo: 'vencidos' },
];

/**
 * Pagos: las mensualidades del mes en curso, como en Tocadiscos. Los pagos se capturan a mano
 * (no hay cobro con tarjeta en línea) y NADA corta el servicio automáticamente: vencer sólo
 * muestra un aviso; suspender es a mano, desde el detalle del cliente.
 */
export function Pagos() {
  const [pestana, setPestana] = useState<EstadoPagoMes | ''>('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const pagos = usePagosDelMes(pestana, q);
  const [pagando, setPagando] = useState<Mensualidad | null>(null);
  const mes = pagos.data ? mesLargo(pagos.data.mes) : 'este mes';

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Pagos"
        subtitulo={
          <>
            Las mensualidades de {mes}. Los pagos se capturan a mano. Nada corta el servicio
            automáticamente.
          </>
        }
      />

      {pagos.data && (
        <section aria-label="Resumen del mes" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta valor={pagos.data.conteos.pagados} etiqueta="Pagados" />
          <Tarjeta valor={pagos.data.conteos.pendientes} etiqueta="Pendientes" />
          <Tarjeta valor={pagos.data.conteos.vencidos} etiqueta="Vencidos" />
          <Tarjeta valor={pesos(pagos.data.cobradoMes)} etiqueta={`Cobrado de ${mes}`} />
        </section>
      )}

      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(texto.trim());
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre del cliente</span>
          <input
            className={`${C.input} mt-0`}
            placeholder="Nombre del cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        <button type="submit" className={C.secundario}>
          Buscar
        </button>
      </form>

      <div
        role="tablist"
        aria-label="Filtrar por estado"
        className="flex gap-4 overflow-x-auto border-b border-linea"
      >
        {PESTANAS.map((p) => {
          const activa = p.valor === pestana;
          return (
            <button
              key={p.texto}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(p.valor)}
              className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold whitespace-nowrap ${
                activa
                  ? 'border-acento-borde text-tinta'
                  : 'border-transparent text-tinta-suave hover:text-tinta'
              }`}
            >
              {p.texto}{' '}
              <span className="font-normal text-tinta-tenue">
                {pagos.data?.conteos[p.conteo] ?? ''}
              </span>
            </button>
          );
        })}
      </div>

      {pagos.isPending ? (
        <Cargando que="las mensualidades" />
      ) : pagos.isError ? (
        <ErrorCarga que="las mensualidades" />
      ) : pagos.data.mensualidades.length === 0 ? (
        <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>
          No hay mensualidades con ese filtro.
        </p>
      ) : (
        <ul aria-label="Mensualidades" className={C.lista}>
          {pagos.data.mensualidades.map((m) => (
            <li key={m.empresaId} aria-label={m.empresa} className={C.fila}>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/plataforma/clientes/${m.empresaId}`}
                  className={`${C.filaTitulo} hover:underline`}
                >
                  {m.empresa}
                </Link>
                <div className={C.filaDetalle}>
                  Plan {m.plan} · corte el día {m.diaCorte} · vence el {fechaDia(m.vencimiento)}
                </div>
                <div className={C.filaDetalle}>
                  {m.ultimoPago
                    ? `Último pago: ${pesos(m.ultimoPago.monto)} el ${fechaDia(m.ultimoPago.fechaPago)}`
                    : 'Sin pagos registrados'}
                </div>
              </div>
              {!m.empresaActiva && <Chip clase={CHIP_NEUTRAL}>Desactivado</Chip>}
              {(m.estadoEfectivo === 'suspendida' || m.estadoEfectivo === 'cancelada') && (
                <ChipEstado estado={m.estadoEfectivo} />
              )}
              <ChipPago estado={m.estadoPago} />
              <button
                type="button"
                className={C.secundario}
                disabled={m.estadoEfectivo === 'cancelada'}
                title={
                  m.estadoEfectivo === 'cancelada'
                    ? 'Reactívalo antes de registrar un pago'
                    : undefined
                }
                onClick={() => setPagando(m)}
              >
                Registrar pago
              </button>
            </li>
          ))}
        </ul>
      )}

      {pagando && (
        <RegistrarPago
          cliente={{
            empresaId: pagando.empresaId,
            empresa: pagando.empresa,
            plan: pagando.plan,
            precioMensual: pagando.precioMensual,
            vencimiento: pagando.vencimiento,
            periodicidad: pagando.periodicidad,
          }}
          onCerrar={() => setPagando(null)}
        />
      )}
    </div>
  );
}
