import { useState, type FormEvent } from 'react';

import { NOMBRE_MOTIVO_ACTUALIZACION } from '../../alertas/textos';
import type { Empresa, EstadoAgenteSucursal, VersionAgente } from '../../api/tipos';
import { api, useAccion, useEstadoAgentes, useVersionesAgente } from './consultas';
import { estadoActualizacion, FORMATO_VERSION } from './reglasActualizacion';
import { CLASE_BOTON, CLASE_INPUT, CLASE_PRIMARIO, CLASE_TABLA } from './estilos';

const TAMANO_MAXIMO = 128 * 1024 * 1024;
const ZONA_PANEL = 'America/Mexico_City';

/** Fecha y hora en la zona de presentación (UTC en la base, CDMX al mostrar). */
function fechaHoraEn(zona: string, instante: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instante));
}

function megas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString('es-MX', { maximumFractionDigits: 1 })} MB`;
}

function textoEstado(f: EstadoAgenteSucursal): string {
  switch (estadoActualizacion(f)) {
    case 'sin-bandera':
      return 'Manual: no se actualiza sola';
    case 'sin-version':
      return 'Sin versión publicada';
    case 'al-dia':
      return 'Al día';
    case 'fallo': {
      const motivo = f.actualizacion?.motivo;
      return `Falló: ${motivo ? NOMBRE_MOTIVO_ACTUALIZACION[motivo] : 'motivo sin dato'}`;
    }
    case 'pendiente':
      return f.versionAgente === null
        ? 'Pendiente: el agente no ha reportado su versión'
        : 'Pendiente: la toma en su siguiente revisión';
  }
}

/**
 * Auto-update del agente (F2-143), sólo para admin_global: el canal de versiones (publicar un
 * `agente.exe`, retirar = regresar a la anterior) y la bandera de rollout de cada sucursal de la
 * empresa del selector. Nada de esto toca SoftRestaurant: cambia el binario del agente en la PC del
 * restaurante, por su watchdog.
 */
export function Actualizaciones({ empresa }: { empresa: Empresa }) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="titulo-versiones" className="space-y-3">
        <h2 id="titulo-versiones" className="text-base font-semibold text-tinta">
          Versiones del agente
        </h2>
        <p className="text-sm text-tinta-suave">
          La versión vigente es la publicada más reciente sin retirar: es la que toman solas las
          sucursales con la actualización automática encendida. Retirar la vigente las regresa a la
          anterior.
        </p>
        <Publicar />
        <ListaVersiones />
      </section>
      <section aria-labelledby="titulo-rollout" className="space-y-3">
        <h2 id="titulo-rollout" className="text-base font-semibold text-tinta">
          Sucursales de {empresa.nombre}
        </h2>
        <p className="text-sm text-tinta-suave">
          Enciende la actualización automática sucursal por sucursal (rollout gradual). Si una
          instalación falla (binario que no coincide, el agente no se detuvo, la versión nueva no
          arrancó), la sucursal sigue con su versión y se abre una alerta.
        </p>
        <Rollout empresa={empresa} />
      </section>
    </div>
  );
}

function Publicar() {
  const accion = useAccion();
  const [version, setVersion] = useState('');
  const [notas, setNotas] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [claveArchivo, setClaveArchivo] = useState(0);

  const versionMala = version !== '' && !FORMATO_VERSION.test(version);
  const archivoMalo = archivo !== null && (archivo.size === 0 || archivo.size > TAMANO_MAXIMO);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!archivo || versionMala || archivoMalo || version === '') return;
    setAviso(null);
    const r = await accion.correr(
      () => api.publicarVersionAgente(version, notas, archivo),
      ['versiones-agente', 'agentes'],
    );
    if (r.ok) {
      setAviso(`Versión ${r.valor.version} publicada (SHA-256 ${r.valor.sha256.slice(0, 12)}…).`);
      setVersion('');
      setNotas('');
      setArchivo(null);
      setClaveArchivo((k) => k + 1);
    }
  }

  return (
    <form
      onSubmit={enviar}
      aria-label="Publicar versión"
      className="grid gap-3 rounded-lg border border-linea p-3 sm:grid-cols-2"
    >
      <div className="text-sm">
        <label htmlFor="archivo-agente" className="mb-1 block text-tinta-medio">
          Archivo agente.exe
        </label>
        <input
          id="archivo-agente"
          key={claveArchivo}
          type="file"
          accept=".exe,application/octet-stream"
          className={CLASE_INPUT}
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        />
        {archivoMalo && (
          <span role="alert" className="mt-1 block text-xs text-peligro">
            El archivo tiene que pesar entre 1 byte y 128 MB.
          </span>
        )}
      </div>
      <div className="text-sm">
        <label htmlFor="version-agente" className="mb-1 block text-tinta-medio">
          Versión (X.Y.Z)
        </label>
        <input
          id="version-agente"
          className={CLASE_INPUT}
          value={version}
          placeholder="1.4.0"
          onChange={(e) => setVersion(e.target.value.trim())}
          aria-invalid={versionMala}
          aria-describedby="ayuda-version-agente"
        />
        <span
          id="ayuda-version-agente"
          className={`mt-1 block text-xs ${versionMala ? 'text-peligro' : 'text-tinta-tenue'}`}
        >
          {versionMala
            ? 'Tiene que ser X.Y.Z, por ejemplo 1.4.0.'
            : 'La misma que reporta el exe (sin el +commit). Si no coincide, las sucursales lo reportan como "otra versión" y no lo reintentan.'}
        </span>
      </div>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-tinta-medio">Notas (opcional)</span>
        <input
          className={CLASE_INPUT}
          value={notas}
          maxLength={500}
          onChange={(e) => setNotas(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          className={CLASE_PRIMARIO}
          disabled={accion.enCurso || !archivo || version === '' || versionMala || archivoMalo}
        >
          {accion.enCurso ? 'Publicando…' : 'Publicar versión'}
        </button>
        {aviso && (
          <span role="status" className="text-sm text-exito">
            {aviso}
          </span>
        )}
        {accion.error && (
          <span role="alert" className="text-sm text-peligro">
            {accion.error}
          </span>
        )}
      </div>
    </form>
  );
}

function ListaVersiones() {
  const versiones = useVersionesAgente();
  const accion = useAccion();
  const [confirmando, setConfirmando] = useState<string | null>(null);

  if (versiones.isPending) {
    return <p className="text-sm text-tinta-tenue">Cargando versiones…</p>;
  }
  if (versiones.isError) {
    return (
      <p role="alert" className="text-sm text-peligro">
        No se pudieron cargar las versiones del agente.
      </p>
    );
  }
  if (versiones.data.length === 0) {
    return (
      <p className="text-sm text-tinta-tenue">
        Todavía no hay versiones publicadas: ninguna sucursal se actualiza sola hasta que publiques
        una.
      </p>
    );
  }

  async function retirar(v: VersionAgente) {
    setConfirmando(null);
    await accion.correr(() => api.retirarVersionAgente(v.version), ['versiones-agente', 'agentes']);
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      {accion.error && (
        <p role="alert" className="mb-2 text-sm text-peligro">
          {accion.error}
        </p>
      )}
      <table className={CLASE_TABLA}>
        <thead className="text-xs text-tinta-tenue">
          <tr>
            <th className="py-2 pr-3 font-medium">Versión</th>
            <th className="py-2 pr-3 font-medium">Estado</th>
            <th className="py-2 pr-3 font-medium">Publicada</th>
            <th className="py-2 pr-3 font-medium">Tamaño</th>
            <th className="py-2 pr-3 font-medium">SHA-256</th>
            <th className="py-2 font-medium">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {versiones.data.map((v) => (
            <tr key={v.version} aria-label={v.version} className="border-t border-linea align-top">
              <td className="py-2 pr-3 font-medium text-tinta">
                {v.version}
                {v.notas && <span className="block text-xs text-tinta-tenue">{v.notas}</span>}
              </td>
              <td className="py-2 pr-3">
                {v.vigente ? (
                  <span className="rounded bg-exito-fondo px-2 py-0.5 text-xs font-medium text-exito">
                    Vigente
                  </span>
                ) : v.retiradaAt ? (
                  <span className="text-xs text-tinta-tenue">
                    Retirada {fechaHoraEn(ZONA_PANEL, Date.parse(v.retiradaAt))}
                  </span>
                ) : (
                  <span className="text-xs text-tinta-tenue">Anterior</span>
                )}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                {fechaHoraEn(ZONA_PANEL, Date.parse(v.publicadaAt))}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{megas(v.tamanoBytes)}</td>
              <td className="py-2 pr-3 font-mono text-xs" title={v.sha256}>
                {v.sha256.slice(0, 12)}…
              </td>
              <td className="py-2">
                {v.retiradaAt === null &&
                  (confirmando === v.version ? (
                    <span className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={CLASE_PRIMARIO}
                        disabled={accion.enCurso}
                        onClick={() => void retirar(v)}
                      >
                        Sí, retirar {v.version}
                      </button>
                      <button
                        type="button"
                        className={CLASE_BOTON}
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      onClick={() => setConfirmando(v.version)}
                    >
                      Retirar
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rollout({ empresa }: { empresa: Empresa }) {
  const estado = useEstadoAgentes(empresa.id);
  const accion = useAccion();

  if (estado.isPending) {
    return <p className="text-sm text-tinta-tenue">Cargando sucursales…</p>;
  }
  if (estado.isError && estado.data === undefined) {
    return (
      <p role="alert" className="text-sm text-peligro">
        No se pudo cargar el estado de los agentes.
      </p>
    );
  }
  if (estado.data.length === 0) {
    return <p className="text-sm text-tinta-tenue">Esta empresa no tiene sucursales activas.</p>;
  }

  async function cambiar(f: EstadoAgenteSucursal) {
    await accion.correr(
      () => api.actualizacionAutomatica(f.sucursalId, !f.actualizacionAutomatica),
      ['agentes'],
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      {accion.error && (
        <p role="alert" className="mb-2 text-sm text-peligro">
          {accion.error}
        </p>
      )}
      <table className={CLASE_TABLA}>
        <thead className="text-xs text-tinta-tenue">
          <tr>
            <th className="py-2 pr-3 font-medium">Sucursal</th>
            <th className="py-2 pr-3 font-medium">Actualización automática</th>
            <th className="py-2 pr-3 font-medium">Versión que corre</th>
            <th className="py-2 pr-3 font-medium">Objetivo</th>
            <th className="py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {estado.data.map((f) => {
            const e = estadoActualizacion(f);
            return (
              <tr
                key={f.sucursalId}
                aria-label={f.nombre}
                className="border-t border-linea-suave align-top"
              >
                <td className="py-2 pr-3 font-medium text-tinta">{f.nombre}</td>
                <td className="py-2 pr-3">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Actualización automática de ${f.nombre}`}
                      checked={f.actualizacionAutomatica}
                      disabled={accion.enCurso}
                      onChange={() => void cambiar(f)}
                    />
                    <span>{f.actualizacionAutomatica ? 'Encendida' : 'Apagada'}</span>
                  </label>
                </td>
                <td className="py-2 pr-3">{f.versionAgente ?? 'Sin dato'}</td>
                <td className="py-2 pr-3">{f.versionObjetivo ?? '—'}</td>
                <td
                  className={`py-2 ${e === 'fallo' ? 'text-peligro' : e === 'al-dia' ? 'text-exito' : ''}`}
                  data-estado={e}
                  title={e === 'fallo' ? (f.actualizacion?.detalle ?? undefined) : undefined}
                >
                  {textoEstado(f)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
