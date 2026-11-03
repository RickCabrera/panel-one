import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pedir } from '../../api/cliente';
import type { MeseroEnVivo, MeserosEnVivo } from '../../api/tipos';
import { aCentavos, sumar } from '../../dinero/dinero';
import { suscribirTiempoReal } from '../../tiempo-real/socket';
import type { Filtro } from '../inicio/consultas';
import { edadEfectiva, frescura } from '../mesas/reglas';
import { intervaloMesas, useEnVivo } from '../mesas/tiempoReal';

/**
 * Meseros en vivo (MVP): lo cobrado HOY por mesero más lo que tiene en curso en sus mesas
 * abiertas. Con el socket vivo se relee con cada aviso de ingesta (llegan cheques o mesas) y el
 * polling baja a respaldo; sin socket, cada 20 s como el Monitor de mesas.
 */
export function useMeserosEnVivo(filtro: Filtro | null, dia: string) {
  const cliente = useQueryClient();
  const empresaId = filtro?.empresaId;
  const sucursalId = filtro?.sucursalId ?? null;
  const queryKey = ['ventas', 'meseros-en-vivo', empresaId, sucursalId, dia] as const;
  useEffect(() => {
    if (empresaId === undefined) return;
    return suscribirTiempoReal({ empresaId, sucursalId }, () => {
      void cliente.invalidateQueries(
        { queryKey: ['ventas', 'meseros-en-vivo', empresaId, sucursalId] },
        { cancelRefetch: false },
      );
    });
  }, [cliente, empresaId, sucursalId]);
  const enVivo = useEnVivo(filtro);
  const consulta = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      pedir<MeserosEnVivo>('/ventas/meseros-en-vivo', {
        query: { empresaId, sucursalId: filtro?.sucursalId, dia },
        signal,
      }),
    enabled: filtro !== null,
    refetchInterval: intervaloMesas(enVivo),
  });
  return { consulta, enVivo };
}

export type EstadoEnVivo = 'conectada' | 'desconectada' | 'sin-reporte';

export interface FilaEnVivo extends Omit<MeseroEnVivo, 'enCurso' | 'mesasAbiertas' | 'total'> {
  /** Null si su sucursal no está conectada: lo viejo no se muestra como vivo. */
  enCurso: bigint | null;
  mesasAbiertas: number | null;
  cobradoCentavos: bigint;
  total: bigint;
}

export interface TableroEnVivo {
  filas: FilaEnVivo[];
  /** Nombres de las sucursales cuyo último snapshot pasó el umbral (no suman en curso). */
  desconectadas: string[];
  sinReporte: string[];
  cobrado: bigint;
  /** Sólo de sucursales conectadas. */
  enCurso: bigint;
  mesasAbiertas: number;
  cuentas: number;
}

const centavos = (texto: string) => aCentavos(texto) ?? 0n;
const comparar = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);

/**
 * Arma el tablero con la MISMA regla de frescura que el Monitor y la tarjeta "Venta en vivo"
 * (F1-094): una sucursal cuyo snapshot pasó el umbral de desconexión no suma lo que trae en
 * curso. Lo cobrado (cuentas cerradas) sí cuenta siempre. Se reordena por total y la posición se
 * vuelve a contar dentro de cada sucursal (sin mesero no entra al ranking).
 */
export function armarTablero(r: MeserosEnVivo, respuestaAt: number, ahora: number): TableroEnVivo {
  const estado = new Map<string, EstadoEnVivo>();
  for (const s of r.sucursales) {
    if (s.snapshot === null) {
      estado.set(s.sucursalId, 'sin-reporte');
      continue;
    }
    const edad = edadEfectiva(s.snapshot.edadRecepcionSegundos, respuestaAt, ahora);
    estado.set(s.sucursalId, frescura(edad) === 'desconectada' ? 'desconectada' : 'conectada');
  }
  const conectada = (id: string) => estado.get(id) === 'conectada';

  const filas: FilaEnVivo[] = r.meseros
    .map((m) => {
      const vivo = conectada(m.sucursalId);
      const cobrado = centavos(m.cobrado);
      const enCurso = vivo ? centavos(m.enCurso) : null;
      return {
        ...m,
        cobradoCentavos: cobrado,
        enCurso,
        mesasAbiertas: vivo ? m.mesasAbiertas : null,
        mesasSinTotal: vivo ? m.mesasSinTotal : 0,
        comensalesEnMesa: vivo ? m.comensalesEnMesa : 0,
        total: cobrado + (enCurso ?? 0n),
      };
    })
    // Quien sólo tenía mesas en una sucursal desconectada no tiene nada que mostrar.
    .filter((f) => f.cuentas > 0 || f.cobradoCentavos !== 0n || f.mesasAbiertas !== null)
    .sort((a, b) => comparar(a.total, b.total) || comparar(a.cobradoCentavos, b.cobradoCentavos));

  const lugares = new Map<string, number>();
  for (const f of filas) {
    if (f.mesero === null) {
      f.posicion = null;
      continue;
    }
    const lugar = (lugares.get(f.sucursalId) ?? 0) + 1;
    lugares.set(f.sucursalId, lugar);
    f.posicion = lugar;
  }

  const nombres = (e: EstadoEnVivo) =>
    r.sucursales.filter((s) => estado.get(s.sucursalId) === e).map((s) => s.nombre);
  return {
    filas,
    desconectadas: nombres('desconectada'),
    sinReporte: nombres('sin-reporte'),
    cobrado: sumar(filas.map((f) => f.cobradoCentavos)),
    enCurso: sumar(filas.map((f) => f.enCurso ?? 0n)),
    mesasAbiertas: filas.reduce((n, f) => n + (f.mesasAbiertas ?? 0), 0),
    cuentas: filas.reduce((n, f) => n + f.cuentas, 0),
  };
}
