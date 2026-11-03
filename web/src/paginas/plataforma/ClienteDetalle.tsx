import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import type {
  ClienteDetalle as Detalle,
  EstadoSuscripcion,
  PagoSuscripcion,
} from '../../api/tipos';
import { NOMBRE_ROL } from '../../auth/roles';
import { pesos } from '../../dinero/dinero';
import { Dialogo } from '../admin/Dialogo';
import { Cargando, Chip, ChipEstado, ErrorCarga } from './Comunes';
import { apiPlataforma, useAccionPlataforma, useCliente, usePlanes } from './consultas';
import { C, CHIP_ACTIVO, CHIP_NEUTRAL } from './estilos';
import { fechaDia, fechaHora, resumenCliente, TEXTO_METODO } from './formato';
import { RegistrarPago } from './RegistrarPago';

type Abierto =
  | { tipo: 'pago' }
  | { tipo: 'plan' }
  | { tipo: 'contacto' }
  | { tipo: 'estado'; estado: EstadoSuscripcion }
  | { tipo: 'anular'; pago: PagoSuscripcion };

/** El detalle de un cliente: suscripción, pagos, sucursales con su agente y usuarios. */
export function ClienteDetalle() {
  const { id } = useParams();
  const cliente = useCliente(id);
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const cerrar = () => setAbierto(null);

  if (cliente.isPending)
    return (
      <div className={C.pagina}>
        <Cargando que="el cliente" />
      </div>
    );
  if (cliente.isError)
    return (
      <div className={C.pagina}>
        <ErrorCarga que="el cliente" />
      </div>
    );
  const c = cliente.data;
  const s = c.suscripcion;

  return (
    <div className={C.pagina}>
      <p className="text-sm">
        <Link to="/plataforma/clientes" className="text-acento-texto hover:underline">
          ← Clientes
        </Link>
      </p>
      <header className={C.cabecera}>
        <div className="min-w-0">
          <h1 className={C.titulo}>{c.nombre}</h1>
          <p className={C.subtitulo}>
            {resumenCliente(c)}
            {c.ultimaVentaRecibidaAt
              ? ` · última venta ${fechaHora(c.ultimaVentaRecibidaAt)}`
              : ' · sin ventas recibidas'}
          </p>
        </div>
        <ChipEstado estado={s ? s.estadoEfectivo : 'sin_suscripcion'} />
      </header>

      <section aria-label="Suscripción" className={`${C.tarjetaPad} space-y-3`}>
        <h2 className={C.seccion}>Suscripción</h2>
        {s ? (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Dato nombre="Plan">
                {s.plan.nombre} · {pesos(s.plan.precioMensual)} al mes
                {s.plan.periodicidad === 'anual' ? ' (cobro anual)' : ''}
              </Dato>
              <Dato nombre="Sucursales del plan">
                {s.plan.limiteSucursales === null
                  ? 'Ilimitadas'
                  : `Hasta ${s.plan.limiteSucursales}`}
              </Dato>
              <Dato nombre="Próximo pago">
                {fechaDia(s.vencimiento)} (corte el día {s.diaCorte})
              </Dato>
              <Dato nombre="Gracia">
                {s.diasGracia} días: se considera vencido después del {fechaDia(s.fechaLimite)}
              </Dato>
              <Dato nombre="Cliente desde">{fechaDia(s.inicio)}</Dato>
              {s.notas && <Dato nombre="Notas">{s.notas}</Dato>}
            </dl>
            {s.estadoEfectivo === 'vencida' && (
              <p className={C.aviso}>
                Tiene un pago pendiente: sigue entrando y ve un aviso. Nada se suspende solo.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={C.primario}
                disabled={s.estado === 'cancelada'}
                onClick={() => setAbierto({ tipo: 'pago' })}
              >
                Registrar pago
              </button>
              <button
                type="button"
                className={C.secundario}
                onClick={() => setAbierto({ tipo: 'plan' })}
              >
                Cambiar plan o fechas
              </button>
              {s.estado === 'suspendida' || s.estado === 'cancelada' ? (
                <button
                  type="button"
                  className={C.secundario}
                  onClick={() => setAbierto({ tipo: 'estado', estado: 'activa' })}
                >
                  Reactivar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={C.peligro}
                    onClick={() => setAbierto({ tipo: 'estado', estado: 'suspendida' })}
                  >
                    Suspender
                  </button>
                  <button
                    type="button"
                    className={C.peligro}
                    onClick={() => setAbierto({ tipo: 'estado', estado: 'cancelada' })}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-tinta-suave">
              Esta empresa no tiene plan (nació fuera del panel de plataforma). Sin plan no hay
              límite de sucursales ni avisos de pago.
            </p>
            <button
              type="button"
              className={C.primario}
              onClick={() => setAbierto({ tipo: 'plan' })}
            >
              Asignar plan
            </button>
          </>
        )}
      </section>

      <section aria-label="Contacto" className={`${C.tarjetaPad} space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={C.seccion}>Contacto</h2>
          <button
            type="button"
            className={C.secundario}
            onClick={() => setAbierto({ tipo: 'contacto' })}
          >
            Editar
          </button>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Dato nombre="Contacto">{c.contacto.contactoNombre ?? '—'}</Dato>
          <Dato nombre="Teléfono">{c.contacto.contactoTelefono ?? '—'}</Dato>
          <Dato nombre="Correo">{c.contacto.contactoEmail ?? '—'}</Dato>
          <Dato nombre="RFC">{c.contacto.rfc ?? '—'}</Dato>
          {c.contacto.notasPlataforma && <Dato nombre="Notas">{c.contacto.notasPlataforma}</Dato>}
        </dl>
      </section>

      <section aria-label="Pagos" className="space-y-2">
        <h2 className={C.seccion}>Pagos</h2>
        {c.pagos.length === 0 ? (
          <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>Sin pagos registrados.</p>
        ) : (
          <ul className={C.lista}>
            {c.pagos.map((p) => (
              <li key={p.id} aria-label={`Pago del ${fechaDia(p.fechaPago)}`} className={C.fila}>
                <div className="min-w-0 flex-1">
                  <div
                    className={`${C.filaTitulo} ${p.anuladoAt ? 'line-through text-tinta-tenue' : ''}`}
                  >
                    {pesos(p.monto)} {p.moneda} · {TEXTO_METODO[p.metodo]} · {fechaDia(p.fechaPago)}
                  </div>
                  <div className={C.filaDetalle}>
                    Cubre del {fechaDia(p.periodoDesde)} al {fechaDia(p.periodoHasta)}
                    {p.referencia ? ` · ${p.referencia}` : ''}
                  </div>
                  <div className="text-xs text-tinta-tenue">Registró {p.registradoPor}</div>
                  {p.anuladoAt && (
                    <div className="text-xs text-peligro">
                      Anulado el {fechaHora(p.anuladoAt)} por {p.anuladoPor}: {p.motivoAnulacion}
                    </div>
                  )}
                </div>
                {!p.anuladoAt && (
                  <button
                    type="button"
                    className={C.secundario}
                    onClick={() => setAbierto({ tipo: 'anular', pago: p })}
                  >
                    Anular
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Sucursales" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={C.seccion}>Sucursales y agentes</h2>
          <Link
            className="text-sm text-acento-texto hover:underline"
            to={{ pathname: '/admin', search: `?empresa=${c.id}&tab=sucursales` }}
          >
            Administrar sucursales
          </Link>
        </div>
        {c.listaSucursales.length === 0 ? (
          <p className={`${C.tarjetaPad} text-sm text-tinta-suave`}>Sin sucursales todavía.</p>
        ) : (
          <ul className={C.lista}>
            {c.listaSucursales.map((s2) => (
              <li key={s2.id} className={C.fila}>
                <div className="min-w-0 flex-1">
                  <div className={C.filaTitulo}>{s2.nombre}</div>
                  <div className={C.filaDetalle}>
                    {s2.ultimoContactoAt
                      ? `Agente: último reporte ${fechaHora(s2.ultimoContactoAt)}`
                      : s2.tieneApiKey
                        ? 'Agente: nunca se ha reportado'
                        : 'Sin API key (el agente no está instalado)'}
                    {s2.versionAgente ? ` · v${s2.versionAgente}` : ''}
                  </div>
                </div>
                <Chip clase={s2.activo ? CHIP_ACTIVO : CHIP_NEUTRAL}>
                  {s2.activo ? 'Activa' : 'Inactiva'}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Usuarios" className="space-y-2">
        <h2 className={C.seccion}>Usuarios</h2>
        <ul className={C.lista}>
          {c.listaUsuarios.map((u) => (
            <li key={u.id} className={C.fila}>
              <div className="min-w-0 flex-1">
                <div className={C.filaTitulo}>{u.nombre}</div>
                <div className={C.filaDetalle}>
                  {u.email} · {NOMBRE_ROL[u.rol]}
                </div>
                <div className="text-xs text-tinta-tenue">
                  Último acceso: {u.ultimoAccesoAt ? fechaHora(u.ultimoAccesoAt) : 'nunca'}
                </div>
              </div>
              <Chip clase={u.activo ? CHIP_ACTIVO : CHIP_NEUTRAL}>
                {u.activo ? 'Activo' : 'Desactivado'}
              </Chip>
            </li>
          ))}
        </ul>
      </section>

      {abierto?.tipo === 'pago' && s && (
        <RegistrarPago
          cliente={{
            empresaId: c.id,
            empresa: c.nombre,
            plan: s.plan.nombre,
            precioMensual: s.plan.precioMensual,
            vencimiento: s.vencimiento,
            periodicidad: s.plan.periodicidad,
          }}
          onCerrar={cerrar}
        />
      )}
      {abierto?.tipo === 'plan' && <CambiarPlan cliente={c} onCerrar={cerrar} />}
      {abierto?.tipo === 'contacto' && <EditarContacto cliente={c} onCerrar={cerrar} />}
      {abierto?.tipo === 'estado' && (
        <CambiarEstado cliente={c} estado={abierto.estado} onCerrar={cerrar} />
      )}
      {abierto?.tipo === 'anular' && <AnularPago pago={abierto.pago} onCerrar={cerrar} />}
    </div>
  );
}

function Dato({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tinta-tenue">{nombre}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function MensajeError({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className={C.error}>
      {mensaje}
    </p>
  );
}

function Botones({
  onCerrar,
  enCurso,
  texto,
}: {
  onCerrar: () => void;
  enCurso: boolean;
  texto: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={C.secundario} onClick={onCerrar}>
        Cancelar
      </button>
      <button type="submit" className={C.primario} disabled={enCurso}>
        {texto}
      </button>
    </div>
  );
}

function CambiarPlan({ cliente, onCerrar }: { cliente: Detalle; onCerrar: () => void }) {
  const planes = usePlanes();
  const accion = useAccionPlataforma();
  const s = cliente.suscripcion;
  const [planId, setPlanId] = useState(s?.plan.id ?? '');
  const [vencimiento, setVencimiento] = useState(s?.vencimiento ?? '');
  const [diaCorte, setDiaCorte] = useState(
    String(s?.diaCorte ?? Math.min(new Date().getDate(), 28)),
  );
  const [diasGracia, setDiasGracia] = useState(String(s?.diasGracia ?? 5));
  const elegibles = (planes.data ?? []).filter((p) => p.activo || p.id === s?.plan.id);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const elegido = planId || elegibles[0]?.id;
    const cambios = {
      ...(elegido && elegido !== s?.plan.id ? { planId: elegido } : {}),
      ...(s && vencimiento && vencimiento !== s.vencimiento ? { vencimiento } : {}),
      ...(Number(diaCorte) !== s?.diaCorte ? { diaCorte: Number(diaCorte) } : {}),
      ...(Number(diasGracia) !== s?.diasGracia ? { diasGracia: Number(diasGracia) } : {}),
    };
    if (Object.keys(cambios).length === 0) return onCerrar();
    const r = await accion.correr(() => apiPlataforma.guardarSuscripcion(cliente.id, cambios));
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo
      titulo={s ? `Plan de ${cliente.nombre}` : `Asignar plan a ${cliente.nombre}`}
      onCerrar={onCerrar}
    >
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <label className={C.etiqueta}>
          Plan
          <select
            className={C.input}
            value={planId || elegibles[0]?.id || ''}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {elegibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({pesos(p.precioMensual)} al mes)
                {p.activo ? '' : ' · inactivo'}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {s && (
            <label className={C.etiqueta}>
              Próximo pago
              <input
                className={C.input}
                type="date"
                value={vencimiento}
                onChange={(e) => setVencimiento(e.target.value)}
              />
            </label>
          )}
          <label className={C.etiqueta}>
            Día de corte
            <input
              className={C.input}
              type="number"
              min={1}
              max={28}
              value={diaCorte}
              onChange={(e) => setDiaCorte(e.target.value)}
            />
          </label>
          <label className={C.etiqueta}>
            Días de gracia
            <input
              className={C.input}
              type="number"
              min={0}
              max={60}
              value={diasGracia}
              onChange={(e) => setDiasGracia(e.target.value)}
            />
          </label>
        </div>
        <MensajeError mensaje={accion.error} />
        <Botones onCerrar={onCerrar} enCurso={accion.enCurso} texto="Guardar" />
      </form>
    </Dialogo>
  );
}

function EditarContacto({ cliente, onCerrar }: { cliente: Detalle; onCerrar: () => void }) {
  const accion = useAccionPlataforma();
  const [f, setF] = useState({
    nombre: cliente.nombre,
    contactoNombre: cliente.contacto.contactoNombre ?? '',
    contactoTelefono: cliente.contacto.contactoTelefono ?? '',
    contactoEmail: cliente.contacto.contactoEmail ?? '',
    rfc: cliente.contacto.rfc ?? '',
    notasPlataforma: cliente.contacto.notasPlataforma ?? '',
  });
  const campo = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() =>
      apiPlataforma.editarCliente(cliente.id, {
        nombre: f.nombre,
        contactoNombre: f.contactoNombre || null,
        contactoTelefono: f.contactoTelefono || null,
        contactoEmail: f.contactoEmail || null,
        rfc: f.rfc || null,
        notasPlataforma: f.notasPlataforma || null,
      }),
    );
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Datos de ${cliente.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
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
            Correo
            <input
              className={C.input}
              type="email"
              value={f.contactoEmail}
              onChange={campo('contactoEmail')}
            />
          </label>
          <label className={C.etiqueta}>
            RFC
            <input className={C.input} maxLength={13} value={f.rfc} onChange={campo('rfc')} />
          </label>
        </div>
        <label className={C.etiqueta}>
          Notas internas
          <textarea
            className={C.input}
            rows={3}
            maxLength={2000}
            value={f.notasPlataforma}
            onChange={campo('notasPlataforma')}
          />
        </label>
        <MensajeError mensaje={accion.error} />
        <Botones onCerrar={onCerrar} enCurso={accion.enCurso} texto="Guardar" />
      </form>
    </Dialogo>
  );
}

const CONFIRMACION: Record<EstadoSuscripcion, { titulo: string; texto: string; boton: string }> = {
  suspendida: {
    titulo: 'Suspender',
    texto:
      'Sus usuarios ya no podrán entrar ("Tu cuenta está suspendida. Contacta a soporte.") y sus sesiones abiertas se cortan en menos de 15 minutos. Sus agentes SIGUEN mandando ventas: no se pierde nada.',
    boton: 'Suspender',
  },
  cancelada: {
    titulo: 'Cancelar',
    texto:
      'Igual que suspender, pero dice que la cuenta está cancelada. No recibe pagos hasta que se reactive. Sus agentes siguen mandando ventas.',
    boton: 'Cancelar cliente',
  },
  activa: {
    titulo: 'Reactivar',
    texto: 'Sus usuarios vuelven a entrar en cuanto inicien sesión.',
    boton: 'Reactivar',
  },
  prueba: { titulo: 'Pasar a prueba', texto: 'Sus usuarios pueden entrar.', boton: 'Guardar' },
};

function CambiarEstado({
  cliente,
  estado,
  onCerrar,
}: {
  cliente: Detalle;
  estado: EstadoSuscripcion;
  onCerrar: () => void;
}) {
  const accion = useAccionPlataforma();
  const [motivo, setMotivo] = useState('');
  const t = CONFIRMACION[estado];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() =>
      apiPlataforma.cambiarEstado(cliente.id, estado, motivo.trim()),
    );
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`${t.titulo}: ${cliente.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <p className="text-sm text-tinta-suave">{t.texto}</p>
        <label className={C.etiqueta}>
          Motivo (queda en la bitácora)
          <input
            className={C.input}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
        <MensajeError mensaje={accion.error} />
        <Botones onCerrar={onCerrar} enCurso={accion.enCurso} texto={t.boton} />
      </form>
    </Dialogo>
  );
}

function AnularPago({ pago, onCerrar }: { pago: PagoSuscripcion; onCerrar: () => void }) {
  const accion = useAccionPlataforma();
  const [motivo, setMotivo] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const r = await accion.correr(() => apiPlataforma.anularPago(pago.id, motivo.trim()));
    if (r.ok) onCerrar();
  }

  return (
    <Dialogo titulo={`Anular pago de ${pesos(pago.monto)}`} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <p className="text-sm text-tinta-suave">
          El pago no se borra: queda anulado con su motivo y el próximo pago regresa al{' '}
          {fechaDia(pago.periodoDesde)}. Sólo se puede anular el más reciente.
        </p>
        <label className={C.etiqueta}>
          Motivo
          <input
            className={C.input}
            required
            minLength={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
        <MensajeError mensaje={accion.error} />
        <Botones onCerrar={onCerrar} enCurso={accion.enCurso} texto="Anular pago" />
      </form>
    </Dialogo>
  );
}
