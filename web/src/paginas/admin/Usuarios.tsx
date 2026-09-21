import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  type Empresa,
  type Rol,
  type UsuarioAdmin,
} from '../../api/tipos';
import { useUsuario } from '../../auth/contexto';
import { NOMBRE_ROL } from '../../auth/roles';
import { api, useAccion, useAdminsGlobales, useUsuarios } from './consultas';
import { Dialogo } from './Dialogo';
import { CLASE_BOTON, CLASE_INPUT, CLASE_PRIMARIO, CLASE_TABLA } from './estilos';

/** Los roles que se asignan a un usuario DE EMPRESA. admin_global va aparte. */
const ROLES_EMPRESA: readonly Rol[] = ['visor', 'admin_empresa'];

type Abierto = { tipo: 'editar'; usuario: UsuarioAdmin } | { tipo: 'reset'; usuario: UsuarioAdmin };

/**
 * Usuarios de la empresa del alcance (F1-060). Un admin_empresa sólo asigna visor o
 * admin_empresa; sólo un admin_global ve la opción de crear otro admin_global (y la
 * API lo exige igual: 403 para los demás).
 */
export function Usuarios({ empresa }: { empresa: Empresa }) {
  const yo = useUsuario();
  const esGlobal = yo.rol === 'admin_global';
  const usuarios = useUsuarios(empresa.id);
  const globales = useAdminsGlobales(esGlobal);

  return (
    <div className="space-y-6">
      <AltaUsuario empresa={empresa} puedeGlobal={esGlobal} />
      <section aria-label={`Usuarios de ${empresa.nombre}`} className="space-y-2">
        <h2 className="font-medium">Usuarios de {empresa.nombre}</h2>
        <TablaUsuarios consulta={usuarios} vacio="Esta empresa todavía no tiene usuarios." />
      </section>
      {/* Los admin_global no son de ninguna empresa: sólo otro admin_global los ve. */}
      {esGlobal && (
        <section aria-label="Administradores globales" className="space-y-2">
          <h2 className="font-medium">Administradores globales</h2>
          <TablaUsuarios consulta={globales} vacio="No hay administradores globales." />
        </section>
      )}
    </div>
  );
}

function TablaUsuarios({
  consulta,
  vacio,
}: {
  consulta: UseQueryResult<UsuarioAdmin[]>;
  vacio: string;
}) {
  const yo = useUsuario();
  const accion = useAccion();
  const [abierto, setAbierto] = useState<Abierto | null>(null);

  async function cambiarActivo(u: UsuarioAdmin) {
    await accion.correr(() => api.editarUsuario(u.id, { activo: !u.activo }), ['usuarios']);
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      {accion.error && (
        <p role="alert" className="mb-2 text-sm text-red-700">
          {accion.error}
        </p>
      )}
      {consulta.isPending ? (
        <p className="text-sm text-slate-500">Cargando usuarios…</p>
      ) : consulta.isError ? (
        <p role="alert" className="text-sm text-red-700">
          No se pudieron cargar los usuarios.
        </p>
      ) : consulta.data.length === 0 ? (
        <p className="text-sm text-slate-500">{vacio}</p>
      ) : (
        <table className={CLASE_TABLA}>
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Nombre</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Rol</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {consulta.data.map((u) => (
              <tr key={u.id} aria-label={u.email} className="border-t border-slate-200 align-top">
                <td className="py-2 pr-3 break-words">{u.nombre}</td>
                <td className="py-2 pr-3 break-all">{u.email}</td>
                <td className="py-2 pr-3">{NOMBRE_ROL[u.rol]}</td>
                <td className="py-2 pr-3">{u.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  <button
                    type="button"
                    className={CLASE_BOTON}
                    onClick={() => setAbierto({ tipo: 'editar', usuario: u })}
                  >
                    Editar
                  </button>
                  {/* A ti mismo no te das de baja (la API también lo rechaza). */}
                  {u.id !== yo.id && (
                    <button
                      type="button"
                      className={CLASE_BOTON}
                      disabled={accion.enCurso}
                      onClick={() => void cambiarActivo(u)}
                    >
                      {u.activo ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={CLASE_BOTON}
                    onClick={() => setAbierto({ tipo: 'reset', usuario: u })}
                  >
                    Restablecer contraseña
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {abierto?.tipo === 'editar' && (
        <EditarUsuario
          usuario={abierto.usuario}
          esYo={abierto.usuario.id === yo.id}
          onCerrar={() => setAbierto(null)}
        />
      )}
      {abierto?.tipo === 'reset' && (
        <ResetPassword usuario={abierto.usuario} onCerrar={() => setAbierto(null)} />
      )}
    </div>
  );
}

function CampoPassword({
  etiqueta,
  valor,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="text-slate-600">{etiqueta}</span>
      <input
        type="password"
        autoComplete="new-password"
        className={CLASE_INPUT}
        value={valor}
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        onChange={(e) => onCambio(e.target.value)}
      />
      <span className="text-xs text-slate-500">Mínimo {PASSWORD_MIN} caracteres.</span>
    </label>
  );
}

function AltaUsuario({ empresa, puedeGlobal }: { empresa: Empresa; puedeGlobal: boolean }) {
  const accion = useAccion();
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<Rol>('visor');
  const [password, setPassword] = useState('');
  const roles: readonly Rol[] = puedeGlobal ? [...ROLES_EMPRESA, 'admin_global'] : ROLES_EMPRESA;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(
      () =>
        api.crearUsuario({
          email,
          nombre,
          rol,
          // Un admin_global no lleva empresa; los demás, la del alcance.
          empresaId: rol === 'admin_global' ? null : empresa.id,
          password,
        }),
      ['usuarios'],
    );
    // La contraseña se borra del formulario pase lo que pase.
    setPassword('');
    if (r.ok) {
      setEmail('');
      setNombre('');
      setRol('visor');
    }
  }

  return (
    <form
      aria-label="Nuevo usuario"
      onSubmit={(e) => void enviar(e)}
      className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
    >
      <label className="min-w-0 text-sm">
        <span className="text-slate-600">Email</span>
        <input
          type="email"
          className={CLASE_INPUT}
          value={email}
          required
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="min-w-0 text-sm">
        <span className="text-slate-600">Nombre</span>
        <input
          className={CLASE_INPUT}
          value={nombre}
          required
          maxLength={120}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <label className="min-w-0 text-sm">
        <span className="text-slate-600">Rol</span>
        <select className={CLASE_INPUT} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {NOMBRE_ROL[r]}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {rol === 'admin_global'
            ? 'Ve y administra TODAS las empresas; no pertenece a ninguna.'
            : `En la empresa ${empresa.nombre}.`}
        </span>
      </label>
      <CampoPassword etiqueta="Contraseña inicial" valor={password} onCambio={setPassword} />
      {accion.error && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {accion.error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" className={CLASE_PRIMARIO} disabled={accion.enCurso}>
          Agregar usuario
        </button>
      </div>
    </form>
  );
}

function EditarUsuario({
  usuario,
  esYo,
  onCerrar,
}: {
  usuario: UsuarioAdmin;
  esYo: boolean;
  onCerrar: () => void;
}) {
  const accion = useAccion();
  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  // El rol de un admin_global no se cambia, y el tuyo tampoco (la API da 400).
  const rolFijo = esYo || usuario.rol === 'admin_global';

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const cambios = {
      ...(nombre !== usuario.nombre ? { nombre } : {}),
      ...(rol !== usuario.rol ? { rol } : {}),
    };
    if (Object.keys(cambios).length === 0) {
      onCerrar();
      return;
    }
    const r = await accion.correr(() => api.editarUsuario(usuario.id, cambios), ['usuarios']);
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Editar ${usuario.email}`} onCerrar={onCerrar}>
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
        <label className="block text-sm">
          <span className="text-slate-600">Rol</span>
          <select
            className={CLASE_INPUT}
            value={rol}
            disabled={rolFijo}
            onChange={(e) => setRol(e.target.value as Rol)}
          >
            {(rolFijo ? [usuario.rol] : ROLES_EMPRESA).map((r) => (
              <option key={r} value={r}>
                {NOMBRE_ROL[r]}
              </option>
            ))}
          </select>
        </label>
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

function ResetPassword({ usuario, onCerrar }: { usuario: UsuarioAdmin; onCerrar: () => void }) {
  const accion = useAccion();
  const [password, setPassword] = useState('');
  const [listo, setListo] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() => api.resetPassword(usuario.id, password));
    setPassword('');
    if (r.ok) setListo(true);
  }

  return (
    <Dialogo titulo={`Restablecer contraseña de ${usuario.email}`} onCerrar={onCerrar}>
      {listo ? (
        <div className="space-y-3 text-sm">
          <p role="status">
            Contraseña restablecida. Sus sesiones abiertas en otros navegadores se cierran en cuanto
            intenten renovarse (a más tardar en 15 minutos).
          </p>
          <div className="flex justify-end">
            <button type="button" className={CLASE_PRIMARIO} onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void enviar(e)} className="space-y-3">
          <CampoPassword etiqueta="Contraseña nueva" valor={password} onCambio={setPassword} />
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
              Restablecer
            </button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}
