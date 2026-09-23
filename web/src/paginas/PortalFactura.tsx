import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useParams, useSearchParams } from 'react-router';

import { BASE_API } from '../api/base';
import { ErrorApi } from '../api/cliente';
import type {
  ConsultaCodigoPortal,
  FacturaPortal,
  PortalPublico,
  ReceptorPortal,
  RegimenFiscal,
  TicketPortal,
  UsoCfdi,
} from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { BLANCO } from '../tema/paleta';
import { consultarCodigo, pedirFactura, useCatalogosSat, usePortal } from './portal/consultas';
import {
  camposDelApi,
  erroresReceptor,
  esCodigoValido,
  estadoDelApi,
  fechaTicket,
  iniciales,
  normalizarCodigo,
  normalizarRfc,
  QUE_HACER,
  RECEPTOR_VACIO,
  regimenesPara,
  textoSobre,
  ultimoDia,
  usosPara,
  type CampoReceptor,
  type ErroresReceptor,
} from './portal/reglas';

/**
 * Portal PÚBLICO de autofactura (F2-103): `/f/:slug`, sin sesión, pensado para el celular (el
 * cliente llega escaneando el QR del ticket). Tres pasos: el código (precargado con `?c=`), los
 * datos fiscales y la confirmación; y la pantalla de éxito.
 *
 * Hoy el api NO emite (la emisión es F2-104): `emisionDisponible` llega en false, y el portal
 * deja consultar el código pero no le pide al cliente sus datos para luego fallar. Si alguien
 * llega a pedir la factura igual, el api contesta 503 y aquí se dice tal cual.
 *
 * El código viaja en la URL: la página pide `no-referrer`, como la baja de reportes.
 */

const CONTROL =
  'w-full min-w-0 rounded-lg border border-linea-fuerte bg-superficie px-3 py-2.5 text-base focus:border-acento-borde focus:outline-none aria-[invalid=true]:border-peligro';
const ETIQUETA = 'flex flex-col gap-1 text-sm font-medium';
const AYUDA = 'text-xs font-normal text-tinta-tenue';
const ERROR_CAMPO = 'text-sm font-normal text-peligro';
const SECUNDARIO =
  'rounded-lg border border-linea-fuerte px-4 py-2.5 text-base font-medium text-tinta-medio disabled:opacity-50';

type Paso =
  | { tipo: 'codigo' }
  | { tipo: 'datos'; codigo: string; ticket: TicketPortal }
  | { tipo: 'confirmar'; codigo: string; ticket: TicketPortal }
  | { tipo: 'exito'; factura: FacturaPortal };

export function PortalFactura() {
  const { slug = '' } = useParams();
  const portal = usePortal(slug);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  if (portal.isPending) {
    return (
      <Marco>
        <p role="status" className="p-6 text-sm text-tinta-tenue">
          Cargando el portal de facturación…
        </p>
      </Marco>
    );
  }
  if (portal.isError) {
    const noExiste = portal.error instanceof ErrorApi && portal.error.status === 404;
    return (
      <Marco>
        <div className="p-6">
          <h1 className="mb-2 text-lg font-semibold">Facturación electrónica</h1>
          <p role="alert" className="text-sm text-peligro">
            {noExiste
              ? 'Este enlace de facturación no existe o ya no está activo. Revisa la dirección o el QR de tu ticket.'
              : mensajeDeRed(portal.error)}
          </p>
          {!noExiste && (
            <button
              type="button"
              className={`${SECUNDARIO} mt-4`}
              onClick={() => void portal.refetch()}
            >
              Reintentar
            </button>
          )}
        </div>
      </Marco>
    );
  }
  return <Contenido portal={portal.data} />;
}

function mensajeDeRed(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 429) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    if (error.status === 0) return 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
  }
  return 'Algo salió mal. Intenta de nuevo en un momento.';
}

function Marco({ children, portal }: { children: ReactNode; portal?: PortalPublico }) {
  return (
    <main className="min-h-screen bg-fondo text-tinta">
      <div className="mx-auto w-full max-w-lg">
        {portal && <Cabecera portal={portal} />}
        <section className="bg-superficie sm:mt-4 sm:rounded-lg sm:border sm:border-linea">
          {children}
        </section>
      </div>
    </main>
  );
}

function Cabecera({ portal }: { portal: PortalPublico }) {
  const tinta = textoSobre(portal.color);
  return (
    <header
      className="flex items-center gap-3 px-4 py-4 sm:rounded-b-lg"
      style={{ backgroundColor: portal.color, color: tinta }}
    >
      {portal.logoUrl ? (
        <img
          src={`${BASE_API}${portal.logoUrl}`}
          alt={`Logo de ${portal.sucursal}`}
          className="h-12 w-12 shrink-0 rounded-full object-contain"
          // Fondo blanco fijo (no del tema): el logo se diseñó para verse sobre blanco.
          style={{ backgroundColor: BLANCO }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
          style={{ backgroundColor: tinta, color: portal.color }}
        >
          {iniciales(portal.sucursal)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold">{portal.sucursal}</p>
        <p className="text-sm opacity-90">Facturación electrónica</p>
      </div>
    </header>
  );
}

function BotonMarca({
  color,
  children,
  ...props
}: { color: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-full rounded-lg px-4 py-3 text-base font-semibold disabled:opacity-50 sm:w-auto"
      style={{ backgroundColor: color, color: textoSobre(color) }}
    >
      {children}
    </button>
  );
}

function Pasos({ actual }: { actual: 1 | 2 | 3 }) {
  const nombres = ['Tu ticket', 'Tus datos', 'Confirmar'];
  return (
    <ol className="mb-4 flex gap-2 text-xs text-tinta-tenue" aria-label="Pasos">
      {nombres.map((n, i) => (
        <li
          key={n}
          aria-current={i + 1 === actual ? 'step' : undefined}
          className={i + 1 === actual ? 'font-semibold text-tinta' : ''}
        >
          {i + 1}. {n}
        </li>
      ))}
    </ol>
  );
}

function Contenido({ portal }: { portal: PortalPublico }) {
  const [parametros] = useSearchParams();
  const [paso, setPaso] = useState<Paso>({ tipo: 'codigo' });
  const [receptor, setReceptor] = useState<ReceptorPortal>(RECEPTOR_VACIO);
  const [erroresApi, setErroresApi] = useState<ErroresReceptor>({});
  const [avisoCodigo, setAvisoCodigo] = useState<ConsultaCodigoPortal | null>(null);
  const catalogos = useCatalogosSat(portal.emisionDisponible);

  let cuerpo: ReactNode;
  if (paso.tipo === 'codigo') {
    cuerpo = (
      <PasoCodigo
        portal={portal}
        codigoInicial={parametros.get('c') ?? ''}
        avisoInicial={avisoCodigo}
        onContinuar={(codigo, ticket) => {
          setAvisoCodigo(null);
          setPaso({ tipo: 'datos', codigo, ticket });
        }}
      />
    );
  } else if (paso.tipo === 'datos') {
    cuerpo = (
      <PasoDatos
        portal={portal}
        ticket={paso.ticket}
        receptor={receptor}
        onCambiar={setReceptor}
        erroresApi={erroresApi}
        regimenes={catalogos.data?.regimenesFiscales ?? []}
        usos={catalogos.data?.usosCfdi ?? []}
        catalogosListos={catalogos.isSuccess}
        catalogosFallaron={catalogos.isError}
        onVolver={() => setPaso({ tipo: 'codigo' })}
        onContinuar={() => {
          setErroresApi({});
          setPaso({ tipo: 'confirmar', codigo: paso.codigo, ticket: paso.ticket });
        }}
      />
    );
  } else if (paso.tipo === 'confirmar') {
    cuerpo = (
      <PasoConfirmar
        portal={portal}
        codigo={paso.codigo}
        ticket={paso.ticket}
        receptor={receptor}
        regimenes={catalogos.data?.regimenesFiscales ?? []}
        usos={catalogos.data?.usosCfdi ?? []}
        onVolver={() => setPaso({ tipo: 'datos', codigo: paso.codigo, ticket: paso.ticket })}
        onCampos={(e) => {
          setErroresApi(e);
          setPaso({ tipo: 'datos', codigo: paso.codigo, ticket: paso.ticket });
        }}
        onEstado={(consulta) => {
          setAvisoCodigo(consulta);
          setPaso({ tipo: 'codigo' });
        }}
        onExito={(factura) => setPaso({ tipo: 'exito', factura })}
      />
    );
  } else {
    cuerpo = <Exito factura={paso.factura} />;
  }

  return <Marco portal={portal}>{cuerpo}</Marco>;
}

// -----------------------------------------------------------------------------------------------
// Paso 1: el código del ticket

function PasoCodigo({
  portal,
  codigoInicial,
  avisoInicial,
  onContinuar,
}: {
  portal: PortalPublico;
  codigoInicial: string;
  avisoInicial: ConsultaCodigoPortal | null;
  onContinuar: (codigo: string, ticket: TicketPortal) => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState(avisoInicial?.codigo ?? codigoInicial);
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState<ConsultaCodigoPortal | null>(avisoInicial);
  const [enCurso, setEnCurso] = useState(false);
  const autoConsultado = useRef(false);

  async function buscar(valor: string) {
    const codigo = normalizarCodigo(valor);
    setConsulta(null);
    if (!esCodigoValido(codigo)) {
      setError(
        'El código tiene 9 caracteres: letras y números, sin O, 0, I ni 1. Lo encuentras en tu ticket.',
      );
      return;
    }
    setError(null);
    setEnCurso(true);
    try {
      setConsulta(await consultarCodigo(portal.slug, codigo));
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 404) {
        setError('No encontramos ese código en este restaurante. Revisa que esté bien escrito.');
      } else if (e instanceof ErrorApi && e.status === 400) {
        setError(e.message);
      } else {
        setError(mensajeDeRed(e));
      }
    } finally {
      setEnCurso(false);
    }
  }

  // Con `?c=` (el QR del ticket) se consulta solo, una vez.
  useEffect(() => {
    if (autoConsultado.current || avisoInicial || !codigoInicial) return;
    autoConsultado.current = true;
    void buscar(codigoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enviar(e: FormEvent) {
    e.preventDefault();
    void buscar(texto);
  }

  return (
    <div className="p-4 sm:p-6">
      <Pasos actual={1} />
      <h1 className="mb-1 text-xl font-semibold">Factura tu consumo</h1>
      <p className="mb-4 text-sm text-tinta-suave">
        Escribe el código de facturación que viene en tu ticket.
      </p>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-3">
        <label htmlFor={`${id}-codigo`} className={ETIQUETA}>
          Código de facturación
        </label>
        <input
          id={`${id}-codigo`}
          className={`${CONTROL} font-mono tracking-widest uppercase`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          maxLength={20}
          placeholder="7JQRECP3U"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-codigo-error` : undefined}
        />
        {error && (
          <p id={`${id}-codigo-error`} role="alert" className={ERROR_CAMPO}>
            {error}
          </p>
        )}
        <BotonMarca color={portal.color} type="submit" disabled={enCurso}>
          {enCurso ? 'Buscando…' : 'Buscar mi ticket'}
        </BotonMarca>
      </form>

      {consulta && (
        <div aria-live="polite" className="mt-6">
          {consulta.estado === 'pendiente' && consulta.ticket ? (
            <>
              <ResumenTicket ticket={consulta.ticket} codigo={consulta.codigo} />
              {portal.emisionDisponible ? (
                <div className="mt-4">
                  <BotonMarca
                    color={portal.color}
                    type="button"
                    onClick={() => onContinuar(consulta.codigo, consulta.ticket!)}
                  >
                    Continuar con mis datos
                  </BotonMarca>
                </div>
              ) : (
                <p
                  role="status"
                  className="mt-4 rounded-lg border border-aviso-borde bg-aviso-fondo p-3 text-sm text-aviso-fuerte"
                >
                  Este restaurante todavía no emite facturas en línea, así que por ahora no te
                  pedimos tus datos. Tu ticket se puede facturar: guarda tu código y vuelve más
                  tarde, o pide tu factura en el restaurante.
                </p>
              )}
            </>
          ) : (
            <EstadoNoFacturable consulta={consulta} />
          )}
        </div>
      )}
    </div>
  );
}

function EstadoNoFacturable({ consulta }: { consulta: ConsultaCodigoPortal }) {
  return (
    <div role="status" className="rounded-lg border border-linea bg-realce p-4">
      <p className="font-mono text-sm tracking-widest text-tinta-tenue">{consulta.codigo}</p>
      <p className="mt-1 font-semibold">{consulta.mensaje}</p>
      <p className="mt-1 text-sm text-tinta-suave">{QUE_HACER[consulta.estado]}</p>
    </div>
  );
}

function ResumenTicket({ ticket, codigo }: { ticket: TicketPortal; codigo: string }) {
  return (
    <div className="rounded-lg border border-linea p-4" aria-label="Tu consumo" role="group">
      <p className="text-sm text-tinta-suave">
        {ticket.sucursal} · {fechaTicket(ticket.fecha, ticket.zonaHoraria)}
      </p>
      <p className="font-mono text-xs tracking-widest text-tinta-tenue">{codigo}</p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        {ticket.desglose && (
          <>
            <dt>Subtotal</dt>
            <dd className="text-right tabular-nums">{pesos(ticket.desglose.subtotal)}</dd>
            <dt>Impuestos</dt>
            <dd className="text-right tabular-nums">{pesos(ticket.desglose.impuestos)}</dd>
          </>
        )}
        <dt className="text-base font-semibold">Total</dt>
        <dd className="text-right text-base font-semibold tabular-nums">{pesos(ticket.total)}</dd>
      </dl>
      <p className="mt-2 text-xs text-tinta-tenue">
        Puedes facturarlo hasta el {ultimoDia(ticket.expiraAt, ticket.zonaHoraria)}.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------------------------
// Paso 2: los datos fiscales

const CAMPOS_ORDEN: CampoReceptor[] = [
  'rfc',
  'razonSocial',
  'regimenFiscal',
  'cp',
  'usoCfdi',
  'email',
];

function PasoDatos({
  portal,
  ticket,
  receptor,
  onCambiar,
  erroresApi,
  regimenes,
  usos,
  catalogosListos,
  catalogosFallaron,
  onVolver,
  onContinuar,
}: {
  portal: PortalPublico;
  ticket: TicketPortal;
  receptor: ReceptorPortal;
  onCambiar: (r: ReceptorPortal) => void;
  erroresApi: ErroresReceptor;
  regimenes: RegimenFiscal[];
  usos: UsoCfdi[];
  catalogosListos: boolean;
  catalogosFallaron: boolean;
  onVolver: () => void;
  onContinuar: () => void;
}) {
  const id = useId();
  const [intentado, setIntentado] = useState(Object.keys(erroresApi).length > 0);
  const [errores, setErrores] = useState<ErroresReceptor>(erroresApi);

  const regimenesVisibles = regimenesPara(receptor.rfc, regimenes);
  const usosVisibles = usosPara(receptor.rfc, receptor.regimenFiscal, usos);

  function cambiar(campo: CampoReceptor, valor: string) {
    const siguiente = { ...receptor, [campo]: valor };
    // Si el régimen deja de aplicar, el uso elegido puede dejar de aplicar también.
    if (campo === 'regimenFiscal' || campo === 'rfc') {
      const usosNuevos = usosPara(siguiente.rfc, siguiente.regimenFiscal, usos);
      if (!usosNuevos.some((u) => u.clave === siguiente.usoCfdi)) siguiente.usoCfdi = '';
    }
    onCambiar(siguiente);
    if (intentado) setErrores(erroresReceptor(siguiente, regimenes, usos));
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setIntentado(true);
    const encontrados = erroresReceptor(receptor, regimenes, usos);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) {
      const primero = CAMPOS_ORDEN.find((c) => encontrados[c]);
      if (primero) document.getElementById(`${id}-${primero}`)?.focus();
      return;
    }
    onCambiar({ ...receptor, rfc: normalizarRfc(receptor.rfc), email: receptor.email.trim() });
    onContinuar();
  }

  const propiedades = (campo: CampoReceptor) => ({
    id: `${id}-${campo}`,
    'aria-invalid': errores[campo] !== undefined,
    'aria-describedby':
      [errores[campo] ? `${id}-${campo}-error` : null, `${id}-${campo}-ayuda`]
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const error = (campo: CampoReceptor) =>
    errores[campo] ? (
      <span id={`${id}-${campo}-error`} className={ERROR_CAMPO}>
        {errores[campo]}
      </span>
    ) : null;

  return (
    <div className="p-4 sm:p-6">
      <Pasos actual={2} />
      <h1 className="mb-1 text-xl font-semibold">Tus datos fiscales</h1>
      <p className="mb-4 text-sm text-tinta-suave">
        Escríbelos como aparecen en tu constancia de situación fiscal. Total a facturar:{' '}
        <span className="font-semibold tabular-nums">{pesos(ticket.total)}</span>.
      </p>
      {catalogosFallaron && (
        <p role="alert" className="mb-3 text-sm text-peligro">
          No se pudieron cargar los catálogos del SAT. Recarga la página.
        </p>
      )}
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <div className={ETIQUETA}>
          <label htmlFor={`${id}-rfc`}>RFC</label>
          <input
            {...propiedades('rfc')}
            className={`${CONTROL} uppercase`}
            value={receptor.rfc}
            onChange={(e) => cambiar('rfc', e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={13}
          />
          <span id={`${id}-rfc-ayuda`} className={AYUDA}>
            12 caracteres si es empresa, 13 si es persona física.
          </span>
          {error('rfc')}
        </div>

        <div className={ETIQUETA}>
          <label htmlFor={`${id}-razonSocial`}>Nombre o razón social</label>
          <input
            {...propiedades('razonSocial')}
            className={CONTROL}
            value={receptor.razonSocial}
            onChange={(e) => cambiar('razonSocial', e.target.value)}
            autoComplete="organization"
            maxLength={254}
          />
          <span id={`${id}-razonSocial-ayuda`} className={AYUDA}>
            Sin el régimen de capital: "EMPRESA EJEMPLO", no "EMPRESA EJEMPLO S.A. DE C.V.".
          </span>
          {error('razonSocial')}
        </div>

        <div className={ETIQUETA}>
          <label htmlFor={`${id}-regimenFiscal`}>Régimen fiscal</label>
          <select
            {...propiedades('regimenFiscal')}
            className={CONTROL}
            value={receptor.regimenFiscal}
            onChange={(e) => cambiar('regimenFiscal', e.target.value)}
            disabled={!catalogosListos}
          >
            <option value="">Elige tu régimen</option>
            {regimenesVisibles.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.clave} · {r.descripcion}
              </option>
            ))}
          </select>
          <span id={`${id}-regimenFiscal-ayuda`} className={AYUDA}>
            Con tu RFC completo sólo ves los que aplican a tu tipo de persona.
          </span>
          {error('regimenFiscal')}
        </div>

        <div className={ETIQUETA}>
          <label htmlFor={`${id}-cp`}>Código postal de tu domicilio fiscal</label>
          <input
            {...propiedades('cp')}
            className={CONTROL}
            value={receptor.cp}
            onChange={(e) => cambiar('cp', e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
          />
          <span id={`${id}-cp-ayuda`} className={AYUDA}>
            El de tu constancia, aunque vivas en otro lado.
          </span>
          {error('cp')}
        </div>

        <div className={ETIQUETA}>
          <label htmlFor={`${id}-usoCfdi`}>Uso de la factura</label>
          <select
            {...propiedades('usoCfdi')}
            className={CONTROL}
            value={receptor.usoCfdi}
            onChange={(e) => cambiar('usoCfdi', e.target.value)}
            disabled={!catalogosListos || !receptor.regimenFiscal}
          >
            <option value="">
              {receptor.regimenFiscal ? 'Elige el uso' : 'Primero elige tu régimen'}
            </option>
            {usosVisibles.map((u) => (
              <option key={u.clave} value={u.clave}>
                {u.clave} · {u.descripcion}
              </option>
            ))}
          </select>
          <span id={`${id}-usoCfdi-ayuda`} className={AYUDA}>
            Para un consumo en restaurante lo común es G03 (Gastos en general).
          </span>
          {error('usoCfdi')}
        </div>

        <div className={ETIQUETA}>
          <label htmlFor={`${id}-email`}>Correo electrónico</label>
          <input
            {...propiedades('email')}
            type="email"
            className={CONTROL}
            value={receptor.email}
            onChange={(e) => cambiar('email', e.target.value)}
            inputMode="email"
            autoComplete="email"
            maxLength={254}
          />
          <span id={`${id}-email-ayuda`} className={AYUDA}>
            A este correo te enviaremos la factura.
          </span>
          {error('email')}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button type="button" className={SECUNDARIO} onClick={onVolver}>
            Volver
          </button>
          <BotonMarca color={portal.color} type="submit" disabled={!catalogosListos}>
            Revisar mis datos
          </BotonMarca>
        </div>
      </form>
    </div>
  );
}

// -----------------------------------------------------------------------------------------------
// Paso 3: confirmación y emisión

function PasoConfirmar({
  portal,
  codigo,
  ticket,
  receptor,
  regimenes,
  usos,
  onVolver,
  onCampos,
  onEstado,
  onExito,
}: {
  portal: PortalPublico;
  codigo: string;
  ticket: TicketPortal;
  receptor: ReceptorPortal;
  regimenes: RegimenFiscal[];
  usos: UsoCfdi[];
  onVolver: () => void;
  onCampos: (e: ErroresReceptor) => void;
  onEstado: (consulta: ConsultaCodigoPortal) => void;
  onExito: (f: FacturaPortal) => void;
}) {
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regimen = regimenes.find((r) => r.clave === receptor.regimenFiscal);
  const uso = usos.find((u) => u.clave === receptor.usoCfdi);

  async function emitir() {
    setEnCurso(true);
    setError(null);
    try {
      onExito(await pedirFactura(portal.slug, codigo, receptor));
    } catch (e) {
      setEnCurso(false);
      if (e instanceof ErrorApi) {
        const campos = e.status === 400 ? camposDelApi(e.cuerpo) : null;
        if (campos) return onCampos(campos);
        const estado = e.status === 409 ? estadoDelApi(e.cuerpo) : null;
        if (estado) return onEstado({ codigo, estado, mensaje: e.message, ticket: null });
        if (e.status === 503) {
          return setError(e.message);
        }
      }
      setError(mensajeDeRed(e));
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <Pasos actual={3} />
      <h1 className="mb-1 text-xl font-semibold">Confirma tu factura</h1>
      <p className="mb-4 text-sm text-tinta-suave">
        Revisa que todo esté bien: con estos datos se emite tu factura.
      </p>
      <ResumenTicket ticket={ticket} codigo={codigo} />
      <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm" aria-label="Tus datos">
        <Dato titulo="RFC" valor={receptor.rfc} />
        <Dato titulo="Nombre o razón social" valor={receptor.razonSocial} />
        <Dato
          titulo="Régimen fiscal"
          valor={regimen ? `${regimen.clave} · ${regimen.descripcion}` : receptor.regimenFiscal}
        />
        <Dato titulo="Código postal" valor={receptor.cp} />
        <Dato
          titulo="Uso de la factura"
          valor={uso ? `${uso.clave} · ${uso.descripcion}` : receptor.usoCfdi}
        />
        <Dato titulo="Correo" valor={receptor.email} />
      </dl>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-peligro-borde bg-peligro-fondo p-3 text-sm text-peligro-fuerte"
        >
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <button type="button" className={SECUNDARIO} onClick={onVolver} disabled={enCurso}>
          Corregir mis datos
        </button>
        <BotonMarca
          color={portal.color}
          type="button"
          disabled={enCurso}
          onClick={() => void emitir()}
        >
          {enCurso ? 'Emitiendo…' : 'Emitir mi factura'}
        </BotonMarca>
      </div>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-tenue">{titulo}</dt>
      <dd className="break-words font-medium">{valor}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------------------------
// Éxito

function Exito({ factura }: { factura: FacturaPortal }) {
  const { xml, pdf } = factura.descargas;
  return (
    <div className="p-4 sm:p-6" role="status" aria-live="polite">
      <h1 className="mb-1 text-xl font-semibold text-exito">¡Listo! Tu factura se emitió</h1>
      <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm">
        <Dato titulo="Folio fiscal (UUID)" valor={factura.uuid} />
        <Dato titulo="Serie y folio" valor={factura.serieFolio} />
        <Dato titulo="Total" valor={pesos(factura.total)} />
      </dl>
      {xml || pdf ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {pdf && (
            <a href={pdf} className="text-acento-texto underline" download>
              Descargar PDF
            </a>
          )}
          {xml && (
            <a href={xml} className="text-acento-texto underline" download>
              Descargar XML
            </a>
          )}
        </div>
      ) : null}
      <p className="mt-4 text-sm text-tinta-suave">
        {xml || pdf
          ? `También te la enviaremos a ${factura.email}.`
          : `Te enviaremos el PDF y el XML a ${factura.email}. Si no te llega en unos minutos, revisa tu carpeta de correo no deseado.`}
      </p>
    </div>
  );
}
