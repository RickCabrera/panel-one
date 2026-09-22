import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { guardarRegla, useReglasAlertas } from '../../alertas/consultas';
import { NOMBRE_TIPO, textoRegla } from '../../alertas/textos';
import type { Empresa, ReglaAlerta } from '../../api/tipos';
import { Esqueleto, SegunEstado } from '../inicio/Tarjeta';
import { CLASE_INPUT, CLASE_PRIMARIO } from './estilos';

/**
 * Umbrales del centro de alertas por empresa (F2-224). Guardar una regla la aplica en la
 * misma petición: el API recalcula las alertas abiertas y responde las reglas nuevas, sin
 * reiniciar nada. Apagar una regla cierra sus alertas abiertas y deja el historial intacto.
 */
export function ReglasAlertas({ empresa }: { empresa: Empresa }) {
  const reglas = useReglasAlertas(empresa.id);
  return (
    <div className="space-y-3">
      <p className="text-sm text-tinta-tenue">
        Reglas de alerta de {empresa.nombre}. Guardar recalcula al momento las alertas abiertas; el
        historial nunca se borra.
      </p>
      <SegunEstado consulta={reglas} esqueleto={<Esqueleto lineas={4} />}>
        {(filas) => (
          <ul className="space-y-3">
            {filas.map((r) => (
              <FilaRegla key={r.tipo} empresaId={empresa.id} regla={r} />
            ))}
          </ul>
        )}
      </SegunEstado>
    </div>
  );
}

function FilaRegla({ empresaId, regla }: { empresaId: string; regla: ReglaAlerta }) {
  const cliente = useQueryClient();
  const [activa, setActiva] = useState(regla.activa);
  const [umbral, setUmbral] = useState(String(regla.umbral));
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const numero = Number(umbral);
  const valido = /^\d+$/.test(umbral.trim()) && numero >= regla.minimo && numero <= regla.maximo;
  const cambio = activa !== regla.activa || numero !== regla.umbral;
  const unidad = regla.unidad === 'minutos' ? 'min' : regla.unidad === 'horas' ? 'h' : '%';
  const idUmbral = `umbral-${regla.tipo}`;

  async function guardar() {
    setEnCurso(true);
    setError(null);
    setGuardado(false);
    try {
      const nuevas = await guardarRegla(empresaId, regla.tipo, { activa, umbral: numero });
      cliente.setQueryData(['alertas', 'reglas', empresaId], nuevas);
      // Abiertas e historial cambiaron en la misma petición: la campana se actualiza ya.
      await cliente.invalidateQueries({ queryKey: ['alertas'] });
      setGuardado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal.');
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <li
      className="rounded-lg border border-linea bg-superficie p-3"
      aria-label={`Regla: ${NOMBRE_TIPO[regla.tipo]}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={activa}
            onChange={(e) => {
              setActiva(e.target.checked);
              setGuardado(false);
            }}
          />
          {NOMBRE_TIPO[regla.tipo]}
        </label>
        <span className="text-xs text-tinta-tenue">
          {activa ? 'Encendida' : 'Apagada: no genera alertas'}
          {regla.porDefecto ? ' · valor por defecto' : ''}
        </span>
      </div>
      <p className="mt-1 text-sm text-tinta-medio">
        {textoRegla(regla.tipo, valido ? numero : regla.umbral)}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={idUmbral} className="block text-xs text-tinta-suave">
            Umbral ({unidad}, de {regla.minimo} a {regla.maximo})
          </label>
          <input
            id={idUmbral}
            inputMode="numeric"
            className={`${CLASE_INPUT} w-28`}
            value={umbral}
            aria-invalid={!valido}
            onChange={(e) => {
              setUmbral(e.target.value);
              setGuardado(false);
            }}
          />
        </div>
        <button
          type="button"
          className={CLASE_PRIMARIO}
          disabled={!valido || !cambio || enCurso}
          onClick={() => void guardar()}
        >
          {enCurso ? 'Guardando…' : 'Guardar'}
        </button>
        {!valido && (
          <span className="text-sm text-peligro">
            Escribe un número entero entre {regla.minimo} y {regla.maximo}.
          </span>
        )}
        {guardado && !cambio && (
          <span role="status" className="text-sm text-exito">
            Guardado y aplicado.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          No se guardó: {error}
        </p>
      )}
    </li>
  );
}
