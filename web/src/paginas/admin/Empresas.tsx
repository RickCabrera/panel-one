import { useState, type FormEvent } from 'react';

import type { Empresa } from '../../api/tipos';
import { useEmpresas } from '../../filtros/alcance';
import { api, useAccion } from './consultas';
import { Dialogo } from './Dialogo';
import { CLASE_BOTON, CLASE_INPUT, CLASE_PRIMARIO, CLASE_TABLA } from './estilos';

/**
 * Empresas (F1-060): sólo para admin_global (la vista ni se monta para los demás, y
 * la API responde 403 por ruta). Dar de baja una empresa deja fuera a sus usuarios y
 * a sus agentes; sus sucursales y usuarios no se tocan.
 */
export function Empresas() {
  const empresas = useEmpresas();
  const accion = useAccion();
  const [editando, setEditando] = useState<Empresa | null>(null);

  async function cambiarActivo(e: Empresa) {
    await accion.correr(() => api.editarEmpresa(e.id, { activo: !e.activo }), ['empresas']);
  }

  return (
    <div className="space-y-6">
      <AltaEmpresa />
      <div className="min-w-0 overflow-x-auto">
        {accion.error && (
          <p role="alert" className="mb-2 text-sm text-peligro">
            {accion.error}
          </p>
        )}
        {empresas.isPending ? (
          <p className="text-sm text-tinta-tenue">Cargando empresas…</p>
        ) : empresas.isError ? (
          <p role="alert" className="text-sm text-peligro">
            No se pudieron cargar las empresas.
          </p>
        ) : (
          <table className={CLASE_TABLA}>
            <thead className="text-xs text-tinta-tenue">
              <tr>
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {empresas.data.map((e) => (
                <tr key={e.id} aria-label={e.nombre} className="border-t border-linea align-top">
                  <td className="py-2 pr-3 break-words">{e.nombre}</td>
                  <td className="py-2 pr-3">{e.activo ? 'Activa' : 'Inactiva'}</td>
                  <td className="flex flex-wrap gap-2 py-2">
                    <button type="button" className={CLASE_BOTON} onClick={() => setEditando(e)}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      disabled={accion.enCurso}
                      onClick={() => void cambiarActivo(e)}
                    >
                      {e.activo ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editando && <Renombrar empresa={editando} onCerrar={() => setEditando(null)} />}
    </div>
  );
}

function AltaEmpresa() {
  const accion = useAccion();
  const [nombre, setNombre] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() => api.crearEmpresa(nombre), ['empresas']);
    if (r.ok) setNombre('');
  }

  return (
    <form
      aria-label="Nueva empresa"
      onSubmit={(e) => void enviar(e)}
      className="grid min-w-0 gap-3 rounded-lg border border-linea p-3 sm:grid-cols-[1fr_auto] sm:items-end"
    >
      <label className="min-w-0 text-sm">
        <span className="text-tinta-suave">Nombre de la empresa</span>
        <input
          className={CLASE_INPUT}
          value={nombre}
          required
          maxLength={120}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <button type="submit" className={CLASE_PRIMARIO} disabled={accion.enCurso}>
        Agregar empresa
      </button>
      {accion.error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-2">
          {accion.error}
        </p>
      )}
    </form>
  );
}

function Renombrar({ empresa, onCerrar }: { empresa: Empresa; onCerrar: () => void }) {
  const accion = useAccion();
  const [nombre, setNombre] = useState(empresa.nombre);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nombre === empresa.nombre) {
      onCerrar();
      return;
    }
    const r = await accion.correr(() => api.editarEmpresa(empresa.id, { nombre }), ['empresas']);
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Renombrar ${empresa.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className="block text-sm">
          <span className="text-tinta-suave">Nombre</span>
          <input
            className={CLASE_INPUT}
            value={nombre}
            required
            maxLength={120}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        {accion.error && (
          <p role="alert" className="text-sm text-peligro">
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={CLASE_BOTON} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={CLASE_PRIMARIO} disabled={accion.enCurso}>
            Guardar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
