import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { pesos } from '../../dinero/dinero';
import { NOMBRE_PRODUCTO } from '../../marca/Marca';
import { Dialogo } from '../admin/Dialogo';
import { generarPassword } from '../onboarding/password';
import { Cabecera, Cargando, ChipEstado, ErrorCarga } from './Comunes';
import {
  apiPlataforma,
  useAccionPlataforma,
  useClientes,
  usePlanes,
  type FiltroEstadoCliente,
} from './consultas';
import { C } from './estilos';
import { fechaDia, resumenCliente, TEXTO_ESTADO } from './formato';

const FILTROS: { valor: FiltroEstadoCliente; texto: string }[] = [
  { valor: '', texto: 'Todos' },
  { valor: 'activa', texto: 'Activos' },
  { valor: 'prueba', texto: 'En prueba' },
  { valor: 'vencida', texto: 'Vencidos' },
  { valor: 'suspendida', texto: 'Suspendidos' },
  { valor: 'cancelada', texto: 'Cancelados' },
  { valor: 'sin_suscripcion', texto: 'Sin plan' },
];

function esFiltro(v: string | null): v is FiltroEstadoCliente {
  return FILTROS.some((f) => f.valor === v);
}

/** Clientes: los negocios que usan el sistema, con su estado de membresía. */
export function Clientes() {
  const [parametros, setParametros] = useSearchParams();
  const pedido = parametros.get('estado');
  const estado: FiltroEstadoCliente = esFiltro(pedido) ? pedido : '';
  const [texto, setTexto] = useState(parametros.get('q') ?? '');
  const q = parametros.get('q') ?? '';
  const clientes = useClientes(estado, q);
  const [alta, setAlta] = useState(false);

  function cambiar(nuevo: { estado?: FiltroEstadoCliente; q?: string }) {
    const p = new URLSearchParams(parametros);
    for (const [k, v] of Object.entries(nuevo)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParametros(p, { replace: true });
  }

  return (
    <div className={C.pagina}>
      <Cabecera
        titulo="Clientes"
        subtitulo={`Los negocios que usan ${NOMBRE_PRODUCTO}.`}
        accion={
          <button type="button" className={C.primario} onClick={() => setAlta(true)}>
            Dar de alta cliente
          </button>
        }
      />

      <form
        role="search"
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          cambiar({ q: texto.trim() });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre del cliente</span>
          <input
            className={`${C.input} mt-0`}
            placeholder="Nombre del cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Estado</span>
          <select
            className={`${C.input} mt-0`}
            value={estado}
            onChange={(e) => cambiar({ estado: e.target.value as FiltroEstadoCliente })}
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.texto}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={C.secundario}>
          Buscar
        </button>
      </form>

      {clientes.isPending ? (
        <Cargando que="los clientes" />
      ) : clientes.isError ? (
        <ErrorCarga que="los clientes" />
      ) : clientes.data.length === 0 ? (
        <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>
          {estado || q ? 'Ningún cliente coincide con el filtro.' : 'Todavía no hay clientes.'}
        </p>
      ) : (
        <ul aria-label="Clientes" className={C.lista}>
          {clientes.data.map((c) => (
            <li key={c.id} className={C.fila}>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/plataforma/clientes/${c.id}`}
                  className={`${C.filaTitulo} hover:underline`}
                >
                  {c.nombre}
                </Link>
                <div className={C.filaDetalle}>{resumenCliente(c)}</div>
                {c.suscripcion && (
                  <div className="text-xs text-tinta-tenue">
                    Plan {c.suscripcion.plan.nombre} · vence el{' '}
                    {fechaDia(c.suscripcion.vencimiento)}
                  </div>
                )}
              </div>
              {!c.activo && <span className="text-xs text-tinta-tenue">Dada de baja</span>}
              <ChipEstado
                estado={c.suscripcion ? c.suscripcion.estadoEfectivo : 'sin_suscripcion'}
              />
            </li>
          ))}
        </ul>
      )}
      {alta && <AltaCliente onCerrar={() => setAlta(false)} />}
    </div>
  );
}

function AltaCliente({ onCerrar }: { onCerrar: () => void }) {
  const planes = usePlanes();
  const accion = useAccionPlataforma();
  const navegar = useNavigate();
  const activos = (planes.data ?? []).filter((p) => p.activo);
  const [f, setF] = useState({
    nombre: '',
    contactoNombre: '',
    contactoTelefono: '',
    contactoEmail: '',
    rfc: '',
    planId: '',
    estado: 'activa' as 'activa' | 'prueba',
    diaCorte: String(Math.min(new Date().getDate(), 28)),
    vencimiento: '',
    adminNombre: '',
    adminEmail: '',
    password: generarPassword(),
  });
  const campo = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const planId = f.planId || activos[0]?.id;
    if (!planId) return;
    const r = await accion.correr(() =>
      apiPlataforma.altaCliente({
        nombre: f.nombre,
        contactoNombre: f.contactoNombre || null,
        contactoTelefono: f.contactoTelefono || null,
        contactoEmail: f.contactoEmail || null,
        rfc: f.rfc || null,
        planId,
        estado: f.estado,
        diaCorte: Number(f.diaCorte),
        ...(f.vencimiento ? { vencimiento: f.vencimiento } : {}),
        administrador: { nombre: f.adminNombre, email: f.adminEmail, password: f.password },
      }),
    );
    if (r.ok) navegar(`/plataforma/clientes/${r.valor.id}`);
  }

  return (
    <Dialogo titulo="Dar de alta cliente" onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-4">
        <fieldset className="space-y-3">
          <legend className={C.seccion}>Negocio</legend>
          <label className={C.etiqueta}>
            Nombre del negocio
            <input
              className={C.input}
              required
              maxLength={120}
              value={f.nombre}
              onChange={campo('nombre')}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={C.etiqueta}>
              Contacto
              <input
                className={C.input}
                maxLength={120}
                value={f.contactoNombre}
                onChange={campo('contactoNombre')}
              />
            </label>
            <label className={C.etiqueta}>
              Teléfono
              <input
                className={C.input}
                maxLength={30}
                value={f.contactoTelefono}
                onChange={campo('contactoTelefono')}
              />
            </label>
            <label className={C.etiqueta}>
              Correo de contacto
              <input
                className={C.input}
                type="email"
                value={f.contactoEmail}
                onChange={campo('contactoEmail')}
              />
            </label>
            <label className={C.etiqueta}>
              RFC (opcional)
              <input className={C.input} maxLength={13} value={f.rfc} onChange={campo('rfc')} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={C.seccion}>Membresía</legend>
          {planes.isPending ? (
            <Cargando que="los planes" />
          ) : activos.length === 0 ? (
            <p className={C.aviso}>
              No hay planes activos.{' '}
              <Link className="underline" to="/plataforma/planes">
                Crea uno
              </Link>{' '}
              primero.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={C.etiqueta}>
                Plan
                <select
                  className={C.input}
                  value={f.planId || activos[0].id}
                  onChange={campo('planId')}
                >
                  {activos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({pesos(p.precioMensual)} al mes)
                    </option>
                  ))}
                </select>
              </label>
              <label className={C.etiqueta}>
                Estado inicial
                <select className={C.input} value={f.estado} onChange={campo('estado')}>
                  <option value="activa">{TEXTO_ESTADO.activa}</option>
                  <option value="prueba">{TEXTO_ESTADO.prueba}</option>
                </select>
              </label>
              <label className={C.etiqueta}>
                Día de corte (1 a 28)
                <input
                  className={C.input}
                  type="number"
                  min={1}
                  max={28}
                  required
                  value={f.diaCorte}
                  onChange={campo('diaCorte')}
                />
              </label>
              <label className={C.etiqueta}>
                Primer vencimiento (opcional)
                <input
                  className={C.input}
                  type="date"
                  value={f.vencimiento}
                  onChange={campo('vencimiento')}
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={C.seccion}>Su administrador (dueño o gerente)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={C.etiqueta}>
              Nombre
              <input
                className={C.input}
                required
                maxLength={120}
                value={f.adminNombre}
                onChange={campo('adminNombre')}
              />
            </label>
            <label className={C.etiqueta}>
              Correo (con el que entra)
              <input
                className={C.input}
                type="email"
                required
                value={f.adminEmail}
                onChange={campo('adminEmail')}
              />
            </label>
          </div>
          <label className={C.etiqueta}>
            Contraseña inicial (cópiala y entrégasela; después la cambia él en Mi cuenta)
            <input
              className={`${C.input} font-mono`}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={f.password}
              onChange={campo('password')}
            />
          </label>
        </fieldset>

        {accion.error && (
          <p role="alert" className={C.error}>
            {accion.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={C.secundario} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="submit"
            className={C.primario}
            disabled={accion.enCurso || activos.length === 0}
          >
            Dar de alta
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
