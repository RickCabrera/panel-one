import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ACENTO } from '../inicio/puntosHora';

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
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow">
      <div className="font-medium">{barra.etiqueta}</div>
      <div>{barra.texto}</div>
      {barra.detalle && <div className="text-slate-500">{barra.detalle}</div>}
    </div>
  );
}

const compacto = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });

export function GraficaPorDia({ barras }: { barras: Barra[] }) {
  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barras} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} minTickGap={12} />
          <YAxis
            width={44}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `$${compacto.format(v)}`}
          />
          <Tooltip content={<TooltipBarra />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="valor" fill={ACENTO} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficaTop({ barras, dinero }: { barras: Barra[]; dinero: boolean }) {
  return (
    <div className="w-full min-w-0" style={{ height: Math.max(120, barras.length * 26 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barras} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => (dinero ? `$${compacto.format(v)}` : compacto.format(v))}
          />
          <YAxis
            type="category"
            dataKey="etiqueta"
            width={110}
            tick={{ fontSize: 11 }}
            interval={0}
          />
          <Tooltip content={<TooltipBarra />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="valor" fill={ACENTO} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
