import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
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
    <div className="rounded-lg border border-linea bg-superficie px-3 py-2 text-xs text-tinta shadow-lg">
      <div className="font-medium text-tinta-suave">{punto.etiqueta}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{punto.texto}</div>
      <div className="text-tinta-tenue">
        {punto.cuentas} {punto.cuentas === 1 ? 'cuenta' : 'cuentas'}
      </div>
    </div>
  );
}

/**
 * Venta por hora (UI-05): un área con degradado. Dentro del hero morado (`sobreHero`) la línea
 * es arena y la rejilla un velo claro; fuera, la serie 1 del tema. La rejilla y los ejes son
 * recesivos (una línea de 1 px, sin eje vertical), el dato es lo único que se nota.
 */
export function GraficaPorHora({
  puntos,
  sobreHero = false,
}: {
  puntos: PuntoHora[];
  sobreHero?: boolean;
}) {
  const { colores } = useTema();
  const idDegradado = `venta-hora-${useId().replace(/:/g, '')}`;
  const linea = sobreHero ? colores['hero-cifra'] : colores['serie-1'];
  const texto = sobreHero ? colores['hero-tenue'] : colores['tinta-tenue'];
  const rejilla = sobreHero ? colores['hero-rejilla'] : colores.rejilla;
  return (
    <div className="h-48 w-full min-w-0 md:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={puntos} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={idDegradado} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={linea} stopOpacity={sobreHero ? 0.42 : 0.28} />
              <stop offset="100%" stopColor={linea} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={rejilla} vertical={false} />
          <XAxis
            dataKey="etiqueta"
            tick={{ fontSize: 11, fill: texto }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
            tickMargin={8}
          />
          <YAxis
            width={48}
            tick={{ fontSize: 11, fill: texto }}
            tickLine={false}
            axisLine={false}
            tickFormatter={pesosCompactos}
            tickCount={4}
          />
          <Tooltip
            content={<TooltipHora />}
            cursor={{ stroke: linea, strokeOpacity: 0.5, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="valor"
            stroke={linea}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${idDegradado})`}
            dot={false}
            activeDot={{
              r: 4.5,
              fill: linea,
              stroke: sobreHero ? colores['hero-fin'] : colores.superficie,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Dona de formas de pago (UI-05): segmentos con un hueco de la superficie entre ellos (en vez
 * de un borde) y esquinas suaves; en el centro, lo pagado (`centro`).
 */
export function Dona({
  datos,
  centro,
}: {
  datos: { nombre: string; valor: number; color: string }[];
  centro?: { valor: string; etiqueta: string };
}) {
  const { colores } = useTema();
  return (
    <div className="relative h-44 w-44 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={datos}
            dataKey="valor"
            nameKey="nombre"
            innerRadius="68%"
            outerRadius="100%"
            paddingAngle={datos.length > 1 ? 2 : 0}
            cornerRadius={4}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            stroke={colores.superficie}
            strokeWidth={1}
          >
            {datos.map((d) => (
              <Cell key={d.nombre} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centro && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-tinta-tenue">{centro.etiqueta}</span>
          <span className="max-w-[7.5rem] truncate text-sm font-semibold tabular-nums text-tinta">
            {centro.valor}
          </span>
        </div>
      )}
    </div>
  );
}
