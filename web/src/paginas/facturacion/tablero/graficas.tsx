import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { pesos, pesosCompactos } from '../../../dinero/dinero';
import { useTema } from '../../../tema/contexto';
import type { PuntoSerie } from './reglas';

/**
 * Barras del tablero de facturación (F2-106): facturado por mes y por hora. `valor` sólo da la
 * altura (Recharts pide `number`); lo que se lee en el tooltip es el importe exacto (`texto`).
 * Propias y no las de Reportes: aquéllas se cargan en diferido y compartirlas las sacaría de su
 * chunk.
 */

function TooltipSerie({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: PuntoSerie }[];
}) {
  const punto = payload?.[0]?.payload;
  if (!active || !punto) return null;
  return (
    <div className="rounded-md border border-linea bg-superficie px-2 py-1 text-xs shadow">
      <div className="font-medium">{punto.etiqueta}</div>
      <div>{pesos(punto.texto)}</div>
      <div className="text-tinta-tenue">
        {punto.cfdis} {punto.cfdis === 1 ? 'factura' : 'facturas'}
      </div>
    </div>
  );
}

export function GraficaSerie({ puntos }: { puntos: PuntoSerie[] }) {
  const { colores } = useTema();
  const eje = { fontSize: 11, fill: colores['tinta-tenue'] };
  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={puntos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colores.rejilla} vertical={false} />
          <XAxis dataKey="etiqueta" tick={eje} minTickGap={12} />
          <YAxis width={44} tick={eje} tickFormatter={pesosCompactos} />
          <Tooltip content={<TooltipSerie />} cursor={{ fill: colores.realce }} />
          <Bar dataKey="valor" fill={colores['serie-1']} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
