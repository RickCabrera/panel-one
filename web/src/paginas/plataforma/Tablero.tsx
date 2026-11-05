import { Link } from 'react-router';

import { pesos } from '../../dinero/dinero';
import { Cabecera, Cargando, ErrorCarga, Tarjeta } from './Comunes';
import { useMetricas } from './consultas';
import { C } from './estilos';
import { fechaDia } from './formato';

/** Tablero de la plataforma: lo que cobramos y cómo están los clientes. */
export function Tablero() {
  const metricas = useMetricas();

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Tablero"
        subtitulo={
          metricas.data
            ? `Cifras al ${fechaDia(metricas.data.hoy)} (hora de la Ciudad de México).`
            : null
        }
      />
      {metricas.isPending ? (
        <Cargando que="las métricas" />
      ) : metricas.isError ? (
        <ErrorCarga que="las métricas" />
      ) : (
        <>
          <section aria-label="Ingresos" className="grid gap-3 sm:grid-cols-2">
            <Tarjeta
              destacada
              valor={pesos(metricas.data.mrr)}
              etiqueta="Ingreso mensual recurrente (MRR)"
            />
            <Tarjeta valor={pesos(metricas.data.ingresosMes)} etiqueta="Cobrado este mes" />
          </section>
          <section
            aria-label="Clientes por estado"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            <Tarjeta valor={metricas.data.activos} etiqueta="Activos" />
            <Tarjeta valor={metricas.data.prueba} etiqueta="En prueba" />
            <Tarjeta valor={metricas.data.vencidos} etiqueta="Vencidos" />
            <Tarjeta valor={metricas.data.suspendidos} etiqueta="Suspendidos" />
            <Tarjeta valor={metricas.data.cancelados} etiqueta="Cancelados" />
            <Tarjeta valor={metricas.data.vencenProximos7Dias} etiqueta="Vencen en 7 días" />
          </section>
          {metricas.data.sinSuscripcion > 0 && (
            <p className={C.aviso}>
              {metricas.data.sinSuscripcion === 1
                ? 'Hay 1 empresa sin plan asignado.'
                : `Hay ${metricas.data.sinSuscripcion} empresas sin plan asignado.`}{' '}
              <Link
                className="font-semibold underline"
                to="/plataforma/clientes?estado=sin_suscripcion"
              >
                Verlas
              </Link>
            </p>
          )}
          <p className="text-xs text-tinta-tenue">
            El MRR suma el precio mensual del plan de los clientes activos y vencidos (los vencidos
            todavía se cobran). Nada corta el servicio automáticamente: vencer sólo muestra un
            aviso; suspender es a mano.
          </p>
        </>
      )}
    </div>
  );
}
