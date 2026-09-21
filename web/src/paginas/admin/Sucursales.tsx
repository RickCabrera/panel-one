import { useState, type FormEvent } from 'react';

import type { Empresa, Sucursal } from '../../api/tipos';
import { useSucursales } from '../../filtros/alcance';
import { api, useAccion } from './consultas';
import { Dialogo } from './Dialogo';
import { CLASE_BOTON, CLASE_INPUT, CLASE_PRIMARIO, CLASE_TABLA } from './estilos';
import { ZONA_POR_DEFECTO, zonasDisponibles } from './zonas';

type Abierto =
  | { tipo: 'editar'; sucursal: Sucursal }
  | { tipo: 'confirmar-key'; sucursal: Sucursal }
  | { tipo: 'key'; sucursal: Sucursal; apiKey: string };

/**
 * Sucursales de la empresa del alcance (F1-060): alta, edición, baja/reactivación y
 * la API key del agente. La empresa es la del selector del Topbar, también para
 * admin_global.
 */
export function Sucursales({ empresa }: { empresa: Empresa }) {
  const sucursales = useSucursales(empresa.id);
  const accion = useAccion();
  const [abierto, setAbierto] = useState<Abierto | null>(null);

  async function cambiarActivo(s: Sucursal) {
    await accion.correr(() => api.editarSucursal(s.id, { activo: !s.activo }), ['sucursales']);
  }

  return (
    <div className="space-y-6">
      <AltaSucursal empresa={empresa} />

      <div className="min-w-0 overflow-x-auto">
        {accion.error && (
          <p role="alert" className="mb-2 text-sm text-red-700">
            {accion.error}
          </p>
        )}
        {sucursales.isPending ? (
          <p className="text-sm text-slate-500">Cargando sucursales…</p>
        ) : sucursales.isError ? (
          <p role="alert" className="text-sm text-red-700">
            No se pudieron cargar las sucursales.
          </p>
        ) : sucursales.data.length === 0 ? (
          <p className="text-sm text-slate-500">Esta empresa todavía no tiene sucursales.</p>
        ) : (
          <table className={CLASE_TABLA}>
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Sucursal</th>
                <th className="py-2 pr-3 font-medium">Zona horaria</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sucursales.data.map((s) => (
                <tr
                  key={s.id}
                  aria-label={s.nombre}
                  className="border-t border-slate-200 align-top"
                >
                  <td className="py-2 pr-3 break-words">{s.nombre}</td>
                  <td className="py-2 pr-3 break-all">{s.zonaHoraria}</td>
                  <td className="py-2 pr-3">{s.activo ? 'Activa' : 'Inactiva'}</td>
                  <td className="flex flex-wrap gap-2 py-2">
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      onClick={() => setAbierto({ tipo: 'editar', sucursal: s })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      disabled={accion.enCurso}
                      onClick={() => void cambiarActivo(s)}
                    >
                      {s.activo ? 'Dar de baja' : 'Reactivar'}
                    </button>
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      onClick={() => setAbierto({ tipo: 'confirmar-key', sucursal: s })}
                    >
                      API key del agente
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {abierto?.tipo === 'editar' && (
        <EditarSucursal sucursal={abierto.sucursal} onCerrar={() => setAbierto(null)} />
      )}
      {abierto?.tipo === 'confirmar-key' && (
        <ConfirmarKey
          sucursal={abierto.sucursal}
          onCerrar={() => setAbierto(null)}
          onEmitida={(apiKey) => setAbierto({ tipo: 'key', sucursal: abierto.sucursal, apiKey })}
        />
      )}
      {abierto?.tipo === 'key' && (
        <MostrarKey
          sucursal={abierto.sucursal}
          apiKey={abierto.apiKey}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

function SelectorZona({
  valor,
  onCambio,
  id,
}: {
  valor: string;
  onCambio: (zona: string) => void;
  id: string;
}) {
  return (
    <select
      id={id}
      className={CLASE_INPUT}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
    >
      {zonasDisponibles(valor).map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </select>
  );
}

function AltaSucursal({ empresa }: { empresa: Empresa }) {
  const accion = useAccion();
  const [nombre, setNombre] = useState('');
  const [zona, setZona] = useState(ZONA_POR_DEFECTO);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(
      () => api.crearSucursal({ empresaId: empresa.id, nombre, zonaHoraria: zona }),
      ['sucursales'],
    );
    if (r.ok) {
      setNombre('');
      setZona(ZONA_POR_DEFECTO);
    }
  }

  return (
    <form
      aria-label="Nueva sucursal"
      onSubmit={(e) => void enviar(e)}
      className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <label className="min-w-0 text-sm">
        <span className="text-slate-600">Nombre de la sucursal</span>
        <input
          className={CLASE_INPUT}
          value={nombre}
          required
          maxLength={120}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <label className="min-w-0 text-sm" htmlFor="alta-sucursal-zona">
        <span className="text-slate-600">Zona horaria</span>
        <SelectorZona id="alta-sucursal-zona" valor={zona} onCambio={setZona} />
      </label>
      <button type="submit" className={CLASE_PRIMARIO} disabled={accion.enCurso}>
        Agregar sucursal
      </button>
      {accion.error && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-3">
          {accion.error}
        </p>
      )}
    </form>
  );
}

function EditarSucursal({ sucursal, onCerrar }: { sucursal: Sucursal; onCerrar: () => void }) {
  const accion = useAccion();
  const [nombre, setNombre] = useState(sucursal.nombre);
  const [zona, setZona] = useState(sucursal.zonaHoraria);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    // Sólo lo que cambió: un PATCH de la zona reclasifica el histórico (ver aviso).
    const cambios = {
      ...(nombre !== sucursal.nombre ? { nombre } : {}),
      ...(zona !== sucursal.zonaHoraria ? { zonaHoraria: zona } : {}),
    };
    if (Object.keys(cambios).length === 0) {
      onCerrar();
      return;
    }
    const r = await accion.correr(() => api.editarSucursal(sucursal.id, cambios), ['sucursales']);
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Editar ${sucursal.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className="block text-sm">
          <span className="text-slate-600">Nombre</span>
          <input
            className={CLASE_INPUT}
            value={nombre}
            required
            maxLength={120}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className="block text-sm" htmlFor="editar-sucursal-zona">
          <span className="text-slate-600">Zona horaria</span>
          <SelectorZona id="editar-sucursal-zona" valor={zona} onCambio={setZona} />
        </label>
        {zona !== sucursal.zonaHoraria && (
          <p role="note" className="text-sm text-amber-800">
            Los reportes cortan el día con la zona actual de la sucursal: cambiarla también mueve de
            día las ventas pasadas en los reportes.
          </p>
        )}
        {accion.error && (
          <p role="alert" className="text-sm text-red-700">
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

function ConfirmarKey({
  sucursal,
  onCerrar,
  onEmitida,
}: {
  sucursal: Sucursal;
  onCerrar: () => void;
  onEmitida: (apiKey: string) => void;
}) {
  const accion = useAccion();

  async function generar() {
    const r = await accion.correr(() => api.rotarApiKey(sucursal.id));
    if (r.ok) onEmitida(r.valor.apiKey);
  }

  return (
    <Dialogo titulo={`API key de ${sucursal.nombre}`} onCerrar={onCerrar}>
      <div className="space-y-3 text-sm">
        <p>
          Se genera una key nueva para el agente de esta sucursal.{' '}
          <strong>
            Si ya tenía una, deja de servir en este momento: el agente no puede enviar datos hasta
            que le pongas la nueva.
          </strong>
        </p>
        {accion.error && (
          <p role="alert" className="text-red-700">
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={CLASE_BOTON} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className={CLASE_PRIMARIO}
            disabled={accion.enCurso}
            onClick={() => void generar()}
          >
            Generar key nueva
          </button>
        </div>
      </div>
    </Dialogo>
  );
}

/**
 * La key en claro, UNA vez. Vive sólo en el estado de este modal: al cerrarlo se
 * pierde y no hay forma de volver a verla (la API sólo guarda su hash). Por eso el
 * modal no se cierra con Escape ni con un clic afuera.
 */
function MostrarKey({
  sucursal,
  apiKey,
  onCerrar,
}: {
  sucursal: Sucursal;
  apiKey: string;
  onCerrar: () => void;
}) {
  const [copiada, setCopiada] = useState<boolean | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <Dialogo titulo={`API key de ${sucursal.nombre}`} onCerrar={onCerrar} cerrable={false}>
      <div className="space-y-3 text-sm">
        <p className="font-medium text-amber-800">
          Cópiala ahora: no se volverá a mostrar. Si la pierdes, hay que generar otra.
        </p>
        <label className="block">
          <span className="text-slate-600">API key</span>
          <input
            readOnly
            value={apiKey}
            onFocus={(e) => e.currentTarget.select()}
            className={`${CLASE_INPUT} font-mono`}
          />
        </label>
        {copiada === true && <p role="status">Copiada al portapapeles.</p>}
        {copiada === false && (
          <p role="alert" className="text-red-700">
            No se pudo copiar: selecciónala y cópiala a mano.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={CLASE_BOTON} onClick={() => void copiar()}>
            Copiar
          </button>
          <button type="button" className={CLASE_PRIMARIO} onClick={onCerrar}>
            Ya la copié, cerrar
          </button>
        </div>
      </div>
    </Dialogo>
  );
}
