import { Link, useSearchParams } from 'react-router';

import { queryVista } from '../filtros/vista';
import { Tarjeta } from './inicio/Tarjeta';
import { Vista } from './Vista';

/**
 * La ayuda de los conteos físicos (F2-123): el proceso completo, y por qué el ajuste se hace en
 * SoftRestaurant y no aquí (el panel sólo LEE del POS: nunca escribe en su base).
 *
 * DECISION PROVISIONAL (nocturno): los pasos DENTRO de SoftRestaurant se describen en genérico
 * (registrar un ajuste de inventario por la diferencia). El menú exacto de la versión del POS no
 * está mapeado en docs/esquema-sr.md §10; se precisa cuando se vea una instalación real (F2-193).
 */
export function AyudaConteos() {
  const [parametros] = useSearchParams();
  return (
    <Vista titulo="Cómo se hace un conteo físico">
      <p className="mb-4 text-sm">
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/conteos', search: queryVista(parametros) }}
        >
          ← Conteos físicos
        </Link>
      </p>
      <Tarjeta titulo="El proceso">
        <ol className="list-decimal space-y-3 pl-5 text-sm" data-testid="ayuda-conteos">
          <li>
            <strong>Crea el conteo</strong> en el panel: elige el almacén y, si no vas a contar
            todo, un grupo de artículos. En ese momento se congela el <em>teórico</em>: la última
            lectura de existencias que mandó el POS. Lo que pase después en el almacén no lo mueve.
          </li>
          <li>
            <strong>Cuenta</strong> desde el celular o la tablet, en el almacén. Busca cada artículo
            por nombre o clave y escribe lo que ves, en su unidad. Deja vacío lo que no contaste:
            vacío no es 0. Si se bloquea la pantalla o se va la red, lo capturado se queda en el
            dispositivo y se envía al volver.
          </li>
          <li>
            <strong>Cierra el conteo</strong> cuando termines. Ya no se puede capturar y queda el
            reporte de diferencias: faltantes y sobrantes en unidades y en pesos (a costo promedio),
            más lo que quedó sin contar o sin teórico, aparte.
          </li>
          <li>
            <strong>Descarga el CSV</strong> del reporte y llévalo a quien registra el inventario.
          </li>
          <li>
            <strong>Ajusta en SoftRestaurant</strong>: registra ahí el ajuste de inventario por cada
            diferencia que aceptes. <strong>El panel nunca ajusta nada en el POS</strong>: sólo lee
            de él, para no poner en riesgo el sistema con el que cobra el restaurante.
          </li>
          <li>
            En la siguiente lectura, el ajuste llega como un movimiento de tipo &laquo;ajuste&raquo;
            en <em>Movimientos y kardex</em>, y las existencias ya lo reflejan.
          </li>
        </ol>
      </Tarjeta>
      <Tarjeta titulo="Buenas prácticas" className="mt-4">
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            Cuenta con el almacén quieto (sin surtir ni recibir mercancía), o anota en la nota qué
            se movió mientras contabas.
          </li>
          <li>
            Mientras capturas no ves el teórico, a propósito: así el conteo no se sesga hacia el
            número esperado.
          </li>
          <li>
            Si el teórico se marca como <em>atrasado</em>, la lectura del POS tenía más de 90
            minutos: las diferencias pueden venir de movimientos que todavía no llegaban.
          </li>
        </ul>
      </Tarjeta>
    </Vista>
  );
}
