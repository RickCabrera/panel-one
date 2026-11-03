import { useState, type FormEvent } from 'react';

import type { AdminInterno, CuentaCliente } from '../../api/tipos';
import { useUsuario } from '../../auth/contexto';
import { NOMBRE_ROL } from '../../auth/roles';
import { NOMBRE_PRODUCTO } from '../../marca/Marca';
import { Dialogo } from '../admin/Dialogo';
import { generarPassword } from '../onboarding/password';
import { Cabecera, Cargando, Chip, ErrorCarga } from './Comunes';
import { apiPlataforma, useAccionPlataforma, useAdministradores } from './consultas';
import { C, CHIP_ACTIVO, CHIP_NEUTRAL } from './estilos';
import { fechaHora } from './formato';

/**
 * Administradores internos (admin_global), como en Tocadiscos. Reglas (las aplica la API; aquí
 * ni se ofrece lo que no se puede): nadie cambia ni restablece la contraseña de OTRO admin (cada
 * quien la suya, en Mi cuenta), nadie borra a otro, nadie se desactiva a sí mismo, y siempre
 * queda al menos uno activo.
 */
export function Administradores() {
  const yo = useUsuario();
  const admins = useAdministradores();
  const accion = useAccionPlataforma();
  const [abierto, setAbierto] = useState<AdminInterno | 'nuevo' | null>(null);

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Administradores"
        subtitulo={`Quién puede entrar a la administración de ${NOMBRE_PRODUCTO} y ver a todos los clientes.`}
        accion={
          <button type="button" className={C.primario} onClick={() => setAbierto('nuevo')}>
            Agregar administrador
          </button>
        }
      />
      {accion.error && (
        <p role="alert" className={C.error}>
          {accion.error}
        </p>
      )}
      {admins.isPending ? (
        <Cargando que="los administradores" />
      ) : admins.isError ? (
        <ErrorCarga que="los administradores" />
      ) : (
        <ul aria-label="Administradores" className={C.lista}>
          {admins.data.map((a) => {
            const esYo = a.id === yo.id;
            return (
              <li key={a.id} aria-label={a.nombre} className={C.fila}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={C.filaTitulo}>{a.nombre}</span>
                    <Chip clase={a.activo ? CHIP_ACTIVO : CHIP_NEUTRAL}>
                      {a.activo ? 'Activo' : 'Desactivado'}
                    </Chip>
                    {esYo && <Chip clase={`${CHIP_NEUTRAL} border border-linea-fuerte`}>Tú</Chip>}
                  </div>
                  <div className={C.filaDetalle}>{a.email}</div>
                  <div className={C.filaDetalle}>
                    Último acceso: {a.ultimoAccesoAt ? fechaHora(a.ultimoAccesoAt) : 'nunca'}
                  </div>
                </div>
                <button type="button" className={C.secundario} onClick={() => setAbierto(a)}>
                  Editar
                </button>
                {!esYo && (
                  <button
                    type="button"
                    className={a.activo ? C.peligro : C.secundario}
                    disabled={accion.enCurso}
                    onClick={() =>
                      void accion.correr(() =>
                        apiPlataforma.editarAdmin(a.id, { activo: !a.activo }),
                      )
                    }
                  >
                    {a.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-tinta-tenue">
        Cada administrador cambia su propia contraseña en Mi cuenta. Nadie puede cambiar ni
        restablecer la de otro, ni borrarlo: sólo desactivarlo.
      </p>

      <ConvertirCuenta />

      {abierto === 'nuevo' && <NuevoAdmin onCerrar={() => setAbierto(null)} />}
      {abierto && abierto !== 'nuevo' && (
        <EditarAdmin admin={abierto} onCerrar={() => setAbierto(null)} />
      )}
    </div>
  );
}

function NuevoAdmin({ onCerrar }: { onCerrar: () => void }) {
  const accion = useAccionPlataforma();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generarPassword);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() => apiPlataforma.crearAdmin({ nombre, email, password }));
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo="Agregar administrador" onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className={C.etiqueta}>
          Nombre
          <input
            className={C.input}
            required
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className={C.etiqueta}>
          Correo
          <input
            className={C.input}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={C.etiqueta}>
          Contraseña inicial (entrégasela; después sólo la cambia él)
          <input
            className={`${C.input} font-mono`}
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {accion.error && (
          <p role="alert" className={C.error}>
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={C.secundario} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={C.primario} disabled={accion.enCurso}>
            Agregar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Nombre y correo. NUNCA la contraseña (no hay campo ni ruta). */
function EditarAdmin({ admin, onCerrar }: { admin: AdminInterno; onCerrar: () => void }) {
  const accion = useAccionPlataforma();
  const [nombre, setNombre] = useState(admin.nombre);
  const [email, setEmail] = useState(admin.email);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const cambios = {
      ...(nombre !== admin.nombre ? { nombre } : {}),
      ...(email !== admin.email ? { email } : {}),
    };
    if (Object.keys(cambios).length === 0) return onCerrar();
    const r = await accion.correr(() => apiPlataforma.editarAdmin(admin.id, cambios));
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Editar ${admin.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className={C.etiqueta}>
          Nombre
          <input
            className={C.input}
            required
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className={C.etiqueta}>
          Correo
          <input
            className={C.input}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {accion.error && (
          <p role="alert" className={C.error}>
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={C.secundario} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className={C.primario} disabled={accion.enCurso}>
            Guardar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

/**
 * "Convertir una cuenta de cliente": el dueño o gerente que ya entra como cliente pasa a
 * administrador SIN cambiarle correo ni contraseña. Deja de pertenecer a su empresa.
 */
function ConvertirCuenta() {
  const accion = useAccionPlataforma();
  const [email, setEmail] = useState('');
  const [cuenta, setCuenta] = useState<CuentaCliente | null>(null);
  const [noHay, setNoHay] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setCuenta(null);
    setNoHay(false);
    setHecho(null);
    const r = await accion.correr(() => apiPlataforma.buscarCuenta(email.trim()));
    if (r.ok) setCuenta(r.valor);
    else {
      accion.limpiar();
      setNoHay(true);
    }
  }

  async function convertir(c: CuentaCliente) {
    const r = await accion.correr(() => apiPlataforma.convertirCuenta(c.id));
    if (r.ok) {
      setCuenta(null);
      setEmail('');
      setHecho(
        `${c.nombre} ya es administrador. Dejó de pertenecer a ${c.empresa}.` +
          (r.valor.empresaSinAdmin
            ? ` Ojo: ${c.empresa} se quedó sin administrador; dale uno en Administración › Usuarios.`
            : ''),
      );
    }
  }

  return (
    <section aria-label="Convertir una cuenta de cliente" className="space-y-3">
      <h2 className={C.seccion}>Convertir una cuenta de cliente</h2>
      <p className="text-sm text-tinta-suave">
        Si la persona ya entra como dueño o gerente de un negocio, búscala por su correo para
        hacerla administrador sin cambiarle el correo ni la contraseña.
      </p>
      <form onSubmit={(e) => void buscar(e)} className="flex flex-wrap items-end gap-2">
        <label className={`${C.etiqueta} min-w-0 flex-1`}>
          Correo de la cuenta
          <input
            className={C.input}
            type="email"
            required
            placeholder="dueno@negocio.mx"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className={C.secundario} disabled={accion.enCurso}>
          Buscar cuenta
        </button>
      </form>
      {noHay && (
        <p role="status" className="text-sm text-tinta-suave">
          No hay una cuenta de cliente con ese correo.
        </p>
      )}
      {cuenta && (
        <div className={`${C.tarjetaPad} space-y-3`}>
          <div>
            <div className={C.filaTitulo}>{cuenta.nombre}</div>
            <div className={C.filaDetalle}>
              {cuenta.email} · {NOMBRE_ROL[cuenta.rol]} de {cuenta.empresa}
              {cuenta.activo ? '' : ' · desactivada'}
            </div>
          </div>
          <p className="text-sm text-tinta-suave">
            Al convertirla podrá entrar a esta administración y ver a todos los clientes, con el
            mismo correo y contraseña. Deja de pertenecer a {cuenta.empresa} (la empresa y sus demás
            usuarios no cambian). Queda en la bitácora.
          </p>
          <button
            type="button"
            className={C.primario}
            disabled={accion.enCurso || !cuenta.activo}
            onClick={() => void convertir(cuenta)}
          >
            Hacer administrador
          </button>
        </div>
      )}
      {accion.error && (
        <p role="alert" className={C.error}>
          {accion.error}
        </p>
      )}
      {hecho && (
        <p role="status" className={C.exito}>
          {hecho}
        </p>
      )}
    </section>
  );
}
