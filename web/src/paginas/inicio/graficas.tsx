import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { pesosCompactos } from '../../dinero/dinero';
import { useTema } from '../../tema/contexto';
import type { PuntoHora } from './puntosHora';

export function TooltipHora({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: PuntoHora }[];
}) {
  const punto = payload?.[0]?.payload;
  if (!active || !punto) return null;
  return (
    <div className="rounded-md border border-linea bg-superficie px-2 py-1 text-xs shadow">
      <div className="font-medium">{punto.etiqueta}</div>
      <div>{punto.texto}</div>
      <div className="text-tinta-tenue">
        {punto.cuentas} {punto.cuentas === 1 ? 'cuenta' : 'cuentas'}
      </div>
    </div>
  );
}

export function GraficaPorHora({ puntos }: { puntos: PuntoHora[] }) {
  const { colores } = useTema();
  return (
    <div className="h-52 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={puntos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colores.rejilla} vertical={false} />
          <XAxis
            dataKey="etiqueta"
            tick={{ fontSize: 11, fill: colores['tinta-tenue'] }}
            interval={3}
          />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: colores['tinta-tenue'] }}
            tickFormatter={pesosCompactos}
          />
          <Tooltip content={<TooltipHora />} />
          <Line
            type="monotone"
            dataKey="valor"
            stroke={colores['serie-1']}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Dona({ datos }: { datos: { nombre: string; valor: number; color: string }[] }) {
  const { colores } = useTema();
  return (
    <div className="h-44 w-44 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={datos}
            dataKey="valor"
            nameKey="nombre"
            innerRadius="60%"
            outerRadius="100%"
            isAnimationActive={false}
            stroke={colores.superficie}
          >
            {datos.map((d) => (
              <Cell key={d.nombre} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
