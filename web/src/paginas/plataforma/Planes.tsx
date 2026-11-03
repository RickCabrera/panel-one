import { useState, type FormEvent } from 'react';

import type { PeriodicidadPlan, Plan } from '../../api/tipos';
import { aCentavos, pesos } from '../../dinero/dinero';
import { Dialogo } from '../admin/Dialogo';
import { Cabecera, Cargando, Chip, ErrorCarga } from './Comunes';
import { apiPlataforma, useAccionPlataforma, usePlanes } from './consultas';
import { C, CHIP_ACTIVO, CHIP_NEUTRAL } from './estilos';
import { plural } from './formato';

/** Planes: lo que vendemos. Uno que nadie usa se borra; uno en uso, se desactiva. */
export function Planes() {
  const planes = usePlanes();
  const accion = useAccionPlataforma();
  const [editando, setEditando] = useState<Plan | 'nuevo' | null>(null);

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Planes"
        subtitulo="Precio mensual en MXN. Un plan anual cobra 12 meses por periodo."
        accion={
          <button type="button" className={C.primario} onClick={() => setEditando('nuevo')}>
            Nuevo plan
          </button>
        }
      />
      {accion.error && (
        <p role="alert" className={C.error}>
          {accion.error}
        </p>
      )}
      {planes.isPending ? (
        <Cargando que="los planes" />
      ) : planes.isError ? (
        <ErrorCarga que="los planes" />
      ) : planes.data.length === 0 ? (
        <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>Todavía no hay planes.</p>
      ) : (
        <ul aria-label="Planes" className={C.lista}>
          {planes.data.map((p) => (
            <li key={p.id} aria-label={p.nombre} className={C.fila}>
              <div className="min-w-0 flex-1">
                <div className={C.filaTitulo}>
                  {p.nombre} · {pesos(p.precioMensual)} al mes
                  {p.periodicidad === 'anual' ? ' (cobro anual)' : ''}
                </div>
                <div className={C.filaDetalle}>
                  {p.limiteSucursales === null
                    ? 'Sucursales ilimitadas'
                    : `Hasta ${plural(p.limiteSucursales, 'sucursal', 'sucursales')}`}{' '}
                  · {plural(p.clientes, 'cliente', 'clientes')}
                </div>
                {p.descripcion && <div className="text-xs text-tinta-tenue">{p.descripcion}</div>}
              </div>
              <Chip clase={p.activo ? CHIP_ACTIVO : CHIP_NEUTRAL}>
                {p.activo ? 'Activo' : 'Inactivo'}
              </Chip>
              <button type="button" className={C.secundario} onClick={() => setEditando(p)}>
                Editar
              </button>
              <button
                type="button"
                className={C.secundario}
                disabled={accion.enCurso}
                onClick={() =>
                  void accion.correr(() => apiPlataforma.editarPlan(p.id, { activo: !p.activo }))
                }
              >
                {p.activo ? 'Desactivar' : 'Activar'}
              </button>
              {p.clientes === 0 && (
                <button
                  type="button"
                  className={C.peligro}
                  disabled={accion.enCurso}
                  onClick={() => void accion.correr(() => apiPlataforma.borrarPlan(p.id))}
                >
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <FormularioPlan
          plan={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function FormularioPlan({ plan, onCerrar }: { plan: Plan | null; onCerrar: () => void }) {
  const accion = useAccionPlataforma();
  const [nombre, setNombre] = useState(plan?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(plan?.descripcion ?? '');
  const [precio, setPrecio] = useState(plan?.precioMensual ?? '');
  const [periodicidad, setPeriodicidad] = useState<PeriodicidadPlan>(
    plan?.periodicidad ?? 'mensual',
  );
  const [limite, setLimite] = useState(plan?.limiteSucursales?.toString() ?? '');
  const precioValido = aCentavos(precio) !== null && (aCentavos(precio) ?? -1n) >= 0n;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!precioValido) return;
    const datos = {
      nombre,
      descripcion: descripcion.trim() || null,
      precioMensual: precio.trim(),
      periodicidad,
      limiteSucursales: limite === '' ? null : Number(limite),
    };
    const r = await accion.correr(() =>
      plan ? apiPlataforma.editarPlan(plan.id, datos) : apiPlataforma.crearPlan(datos),
    );
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={plan ? `Editar ${plan.nombre}` : 'Nuevo plan'} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className={C.etiqueta}>
          Nombre
          <input
            className={C.input}
            required
            maxLength={80}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className={C.etiqueta}>
          Descripción (opcional)
          <input
            className={C.input}
            maxLength={500}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={C.etiqueta}>
            Precio mensual (MXN)
            <input
              className={C.input}
              inputMode="decimal"
              required
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              aria-invalid={!precioValido}
            />
          </label>
          <label className={C.etiqueta}>
            Cobro
            <select
              className={C.input}
              value={periodicidad}
              onChange={(e) => setPeriodicidad(e.target.value as PeriodicidadPlan)}
            >
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </select>
          </label>
          <label className={C.etiqueta}>
            Límite de sucursales
            <input
              className={C.input}
              type="number"
              min={1}
              max={1000}
              placeholder="Ilimitado"
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
            />
          </label>
        </div>
        {accion.error && (
          <p role="alert" className={C.error}>
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={C.secundario} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={C.primario} disabled={accion.enCurso || !precioValido}>
            Guardar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
