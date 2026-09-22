import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { compacto, pesosCompactos } from '../../dinero/dinero';
import { useTema } from '../../tema/contexto';

/**
 * Un punto de las gráficas de reportes. `valor` sólo sirve para la altura de la
 * barra (Recharts pide `number`); lo que se lee es `texto`, formateado desde el
 * importe exacto. Un importe ilegible trae `valor: null` y no dibuja barra.
 */
export interface Barra {
  etiqueta: string;
  valor: number | null;
  texto: string;
  detalle?: string;
}

export function TooltipBarra({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: Barra }[];
}) {
  const barra = payload?.[0]?.payload;
  if (!active || !barra) return null;
  return (
    <div className="rounded-md border border-linea bg-superficie px-2 py-1 text-xs shadow">
      <div className="font-medium">{barra.etiqueta}</div>
      <div>{barra.texto}</div>
      {barra.detalle && <div className="text-tinta-tenue">{barra.detalle}</div>}
    </div>
  );
}

export function GraficaPorDia({ barras }: { barras: Barra[] }) {
  const { colores } = useTema();
  const eje = { fontSize: 11, fill: colores['tinta-tenue'] };
  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barras} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colores.rejilla} vertical={false} />
          <XAxis dataKey="etiqueta" tick={eje} minTickGap={12} />
          <YAxis width={44} tick={eje} tickFormatter={pesosCompactos} />
          <Tooltip content={<TooltipBarra />} cursor={{ fill: colores.realce }} />
          <Bar dataKey="valor" fill={colores['serie-1']} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficaTop({ barras, dinero }: { barras: Barra[]; dinero: boolean }) {
  const { colores } = useTema();
  const eje = { fontSize: 11, fill: colores['tinta-tenue'] };
  return (
    <div className="w-full min-w-0" style={{ height: Math.max(120, barras.length * 26 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barras} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colores.rejilla} horizontal={false} />
          <XAxis type="number" tick={eje} tickFormatter={dinero ? pesosCompactos : compacto} />
          <YAxis type="category" dataKey="etiqueta" width={110} tick={eje} interval={0} />
          <Tooltip content={<TooltipBarra />} cursor={{ fill: colores.realce }} />
          <Bar dataKey="valor" fill={colores['serie-1']} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
