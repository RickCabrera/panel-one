import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import { useUsuario } from '../auth/contexto';
import { useAlcance } from '../filtros/alcance';
import { usePeriodo } from '../filtros/usePeriodo';
import type { PerfilFiscal, RegimenFiscal, RespuestaPerfilFiscal } from '../api/tipos';
import {
  cargarCsd,
  guardarPerfil,
  LLAVE_FACTURACION,
  usePerfilFiscal,
  useRegimenesFiscales,
} from './facturacion/consultas';
import {
  aBase64,
  estadoVigencia,
  erroresPerfil,
  fechaLarga,
  MAX_BYTES_ARCHIVO_CSD,
  normalizarRfc,
  regimenesPara,
  textoDias,
  type FormPerfil,
} from './facturacion/reglas';
import { PortalesAutofactura } from './facturacion/Portales';
import { FacturaSinTicket } from './facturacion/emision/FacturaSinTicket';
import { Folios } from './facturacion/folios/Folios';
import { FacturaGlobal } from './facturacion/global/FacturaGlobal';
import { TableroFacturacion } from './facturacion/tablero/Tablero';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { Vista } from './Vista';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';
const ETIQUETA = 'flex flex-col gap-1 text-sm';
const AYUDA = 'text-xs text-tinta-tenue';
const ERROR_CAMPO = 'text-xs text-peligro';

const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Error inesperado.');

/** Las pestañas de Facturación (`?tab=`). Sin `tab` (o uno desconocido), el tablero. */
export type PestanaFacturacion = 'tablero' | 'manual' | 'global' | 'datos' | 'folios';
const PARAM_TAB = 'tab';

const PESTANAS: readonly { id: PestanaFacturacion; texto: string }[] = [
  { id: 'tablero', texto: 'Tablero' },
  { id: 'manual', texto: 'Sin ticket' },
  { id: 'global', texto: 'Factura global' },
  { id: 'datos', texto: 'Datos fiscales' },
  // F2-110: el saldo de folios es de la PLATAFORMA: sólo el admin_global ve (y monta) la pestaña.
  { id: 'folios', texto: 'Folios' },
];

function leerPestana(
  parametros: URLSearchParams,
  visibles: readonly PestanaFacturacion[],
): PestanaFacturacion {
  const tab = parametros.get(PARAM_TAB) as PestanaFacturacion | null;
  return tab !== null && visibles.includes(tab) ? tab : 'tablero';
}

/**
 * Facturación (sólo administradores). Cuatro pestañas:
 * - Tablero (F2-106): lo vendido contra lo facturado del periodo y la sucursal de la cabecera, las
 *   facturas emitidas, lo que falta por facturar y los correos por reenviar.
 * - Sin ticket (F2-107): factura por un importe capturado a mano, sin cheque (`origen = manual`).
 *   La refacturación de una factura vigente se hace desde la tabla del Tablero.
 * - Factura global (F2-108): los tickets que nadie facturó a tiempo, por sucursal y periodo, a
 *   público en general; configuración, vista previa y emisión.
 * - Datos fiscales (F2-100): con qué datos emite sus facturas la empresa y su certificado de sello
 *   digital (CSD). Del CSD sólo se ve METADATA (número, RFC, vigencia): el .key y su contraseña se
 *   mandan una vez al servidor, que los pasa al PAC sin guardarlos, y aquí se borran del
 *   formulario en cuanto termina el envío. Más los portales de autofactura (F2-103).
 * - Folios (F2-110, sólo admin_global): el saldo de folios del PAC de toda la plataforma, sus
 *   paquetes, el aviso y el reporte mensual por empresa.
 */
export function Facturacion() {
  const usuario = useUsuario();
  const [parametros, setParametros] = useSearchParams();
  const pestanas = PESTANAS.filter((p) => p.id !== 'folios' || usuario.rol === 'admin_global');
  const pestana = leerPestana(
    parametros,
    pestanas.map((p) => p.id),
  );
  const cambiar = (id: PestanaFacturacion) =>
    setParametros((previos) => {
      const nuevos = new URLSearchParams(previos);
      if (id === 'tablero') nuevos.delete(PARAM_TAB);
      else nuevos.set(PARAM_TAB, id);
      return nuevos;
    });

  return (
    <Vista titulo="Facturación">
      <div
        role="tablist"
        aria-label="Facturación"
        className="mb-4 flex gap-1 border-b border-linea"
      >
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              pestana === p.id
                ? 'border-acento font-medium text-tinta'
                : 'border-transparent text-tinta-suave hover:text-tinta'
            }`}
            onClick={() => cambiar(p.id)}
          >
            {p.texto}
          </button>
        ))}
      </div>
      {pestana === 'tablero' && <PestanaTablero />}
      {pestana === 'manual' && <PestanaSinTicket />}
      {pestana === 'global' && <PestanaGlobal />}
      {pestana === 'datos' && <DatosFiscales />}
      {pestana === 'folios' && <Folios />}
    </Vista>
  );
}

function PestanaTablero() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const { sucursales } = useAlcance();
  return (
    <>
      <p className="mb-4 text-sm text-tinta-tenue">
        Lo vendido contra lo facturado en el periodo y la sucursal elegidos arriba. Las facturas
        cuentan por su fecha de emisión en la zona de su sucursal.
      </p>
      <TableroFacturacion filtro={filtro} rango={rango} sucursales={sucursales.data ?? []} />
    </>
  );
}

function PestanaGlobal() {
  const { empresaId, sucursales } = useAlcance();
  return <FacturaGlobal empresaId={empresaId} sucursales={sucursales.data ?? []} />;
}

function PestanaSinTicket() {
  const { empresaId, sucursales } = useAlcance();
  return <FacturaSinTicket empresaId={empresaId} sucursales={sucursales.data ?? []} />;
}

function DatosFiscales() {
  const filtro = useFiltroAlcance();
  const empresaId = filtro?.empresaId ?? null;
  const consulta = usePerfilFiscal(empresaId);
  const regimenes = useRegimenesFiscales();

  return (
    <>
      <p className="mb-4 text-sm text-tinta-tenue">
        Los datos con los que la empresa emite sus facturas (CFDI 4.0) y su certificado de sello
        digital. Sin los dos no se puede facturar.
      </p>
      {empresaId === null ? (
        <Tarjeta titulo="Datos fiscales">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => (
            <Contenido
              // Otra empresa, u otra versión guardada: el formulario vuelve a arrancar de lo guardado.
              key={`${empresaId}-${r.perfil?.actualizadoAt ?? 'nuevo'}`}
              empresaId={empresaId}
              respuesta={r}
              regimenes={regimenes.data ?? []}
            />
          )}
        </SegunEstado>
      )}
      {empresaId !== null && (
        <div className="mt-4">
          <PortalesAutofactura empresaId={empresaId} />
        </div>
      )}
    </>
  );
}

function Contenido({
  empresaId,
  respuesta,
  regimenes,
}: {
  empresaId: string;
  respuesta: RespuestaPerfilFiscal;
  regimenes: readonly RegimenFiscal[];
}) {
  const { perfil, pacSimulado } = respuesta;
  return (
    <div className="flex flex-col gap-4">
      {pacSimulado && (
        <p
          className="rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-sm text-aviso-fuerte"
          data-testid="pac-simulado"
        >
          Este servidor corre con el PAC simulado: el CSD se valida aquí, pero no se registra ante
          ningún proveedor de timbrado ni ante el SAT.
        </p>
      )}
      <FormDatos empresaId={empresaId} perfil={perfil} regimenes={regimenes} />
      <TarjetaCsd empresaId={empresaId} perfil={perfil} />
    </div>
  );
}

function FormDatos({
  empresaId,
  perfil,
  regimenes,
}: {
  empresaId: string;
  perfil: PerfilFiscal | null;
  regimenes: readonly RegimenFiscal[];
}) {
  const queryClient = useQueryClient();
  const base = useId();
  const [form, setForm] = useState<FormPerfil>({
    rfc: perfil?.rfc ?? '',
    razonSocial: perfil?.razonSocial ?? '',
    regimenFiscal: perfil?.regimenFiscal ?? '',
    cp: perfil?.cp ?? '',
    serie: perfil?.serie ?? '',
  });
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errores = erroresPerfil(form, regimenes);
  const opciones = regimenesPara(form.rfc, regimenes);
  const quitaCsd = perfil?.csd != null && normalizarRfc(form.rfc) !== perfil.rfc;
  const cambiar = (campo: keyof FormPerfil) => (valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setIntentado(true);
    setError(null);
    if (Object.keys(errores).length > 0) return;
    setEnviando(true);
    try {
      const r = await guardarPerfil(empresaId, {
        rfc: normalizarRfc(form.rfc),
        razonSocial: form.razonSocial.trim(),
        regimenFiscal: form.regimenFiscal,
        cp: form.cp.trim(),
        serie: form.serie.trim().toUpperCase(),
      });
      queryClient.setQueryData([...LLAVE_FACTURACION, 'perfil', empresaId], {
        perfil: r.perfil,
        pacSimulado: r.pacSimulado,
      });
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  const campo = (
    nombre: keyof FormPerfil,
    etiqueta: string,
    ayuda: string,
    props: { maxLength?: number; inputMode?: 'numeric'; autoCapitalize?: string } = {},
  ) => (
    <div className={ETIQUETA}>
      <label htmlFor={`${base}-${nombre}`} className="font-medium">
        {etiqueta}
      </label>
      <input
        id={`${base}-${nombre}`}
        className={CONTROL}
        value={form[nombre]}
        onChange={(e) => cambiar(nombre)(e.target.value)}
        aria-invalid={intentado && errores[nombre] ? true : undefined}
        aria-describedby={`${base}-${nombre}-nota`}
        {...props}
      />
      <Nota id={`${base}-${nombre}-nota`} error={intentado ? errores[nombre] : undefined}>
        {ayuda}
      </Nota>
    </div>
  );

  return (
    <Tarjeta titulo="Datos fiscales">
      {perfil === null && (
        <p className="mb-3 text-sm text-tinta-tenue" data-testid="sin-perfil">
          Esta empresa todavía no tiene datos fiscales: sin ellos no se puede facturar. Cópialos de
          su Constancia de Situación Fiscal.
        </p>
      )}
      <form onSubmit={enviar} noValidate className="grid gap-3 sm:grid-cols-2">
        {campo('rfc', 'RFC', '12 caracteres persona moral, 13 persona física.', {
          maxLength: 13,
          autoCapitalize: 'characters',
        })}
        {campo('razonSocial', 'Razón social', 'Tal cual la Constancia, sin "S.A. de C.V.".', {
          maxLength: 254,
        })}
        <div className={ETIQUETA}>
          <label htmlFor={`${base}-regimen`} className="font-medium">
            Régimen fiscal
          </label>
          <select
            id={`${base}-regimen`}
            className={CONTROL}
            value={form.regimenFiscal}
            onChange={(e) => cambiar('regimenFiscal')(e.target.value)}
            aria-invalid={intentado && errores.regimenFiscal ? true : undefined}
            aria-describedby={`${base}-regimen-nota`}
          >
            <option value="">Elige…</option>
            {opciones.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.clave} · {r.descripcion}
              </option>
            ))}
          </select>
          <Nota id={`${base}-regimen-nota`} error={intentado ? errores.regimenFiscal : undefined}>
            Sólo los que aplican al tipo de persona del RFC.
          </Nota>
        </div>
        {campo('cp', 'Código postal fiscal', '5 dígitos del domicilio fiscal.', {
          maxLength: 5,
          inputMode: 'numeric',
        })}
        {campo('serie', 'Serie de las facturas', 'De 1 a 25 letras o números.', {
          maxLength: 25,
          autoCapitalize: 'characters',
        })}
        {perfil && (
          <div className="text-sm">
            <span className="font-medium">Último folio emitido</span>
            <p className="mt-1 tabular-nums">{perfil.folioActual}</p>
          </div>
        )}
        {quitaCsd && (
          <p
            role="alert"
            className="rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-sm text-aviso-fuerte sm:col-span-2"
            data-testid="aviso-cambio-rfc"
          >
            Cambiaste el RFC: al guardar se quita el CSD cargado, porque es de {perfil?.rfc}.
            Tendrás que subir el CSD del RFC nuevo.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-peligro sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARIO} disabled={enviando}>
            {enviando
              ? 'Guardando…'
              : quitaCsd
                ? 'Guardar y quitar el CSD'
                : 'Guardar datos fiscales'}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
}

/** La ayuda de un campo, o su error si ya se intentó guardar. */
function Nota({ id, error, children }: { id: string; error?: string; children: string }) {
  return (
    <span id={id} className={error ? ERROR_CAMPO : AYUDA}>
      {error ?? children}
    </span>
  );
}

function Vigencia({ perfil }: { perfil: PerfilFiscal }) {
  const csd = perfil.csd!;
  const estado = estadoVigencia(csd.vigenteHasta, new Date());
  return (
    <div className="text-sm" data-testid="csd">
      {estado.tipo === 'vencido' ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-peligro-borde bg-peligro-fondo px-3 py-2 text-peligro-fuerte"
          data-testid="alerta-csd"
        >
          El CSD venció el {fechaLarga(csd.vigenteHasta)}: no se puede facturar hasta subir uno
          vigente.
        </p>
      ) : estado.tipo === 'por_vencer' ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-aviso-fuerte"
          data-testid="alerta-csd"
        >
          El CSD {textoDias(estado.dias)} ({fechaLarga(csd.vigenteHasta)}). Tramita el nuevo en el
          portal del SAT y súbelo aquí antes de esa fecha.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-tinta-suave">Número de certificado</dt>
        <dd className="tabular-nums">{csd.noCertificado}</dd>
        <dt className="text-tinta-suave">RFC del certificado</dt>
        <dd>{csd.rfc}</dd>
        <dt className="text-tinta-suave">Vigente desde</dt>
        <dd>{fechaLarga(csd.vigenteDesde)}</dd>
        <dt className="text-tinta-suave">Vigente hasta</dt>
        <dd data-testid="csd-hasta">
          {fechaLarga(csd.vigenteHasta)}
          {estado.tipo === 'vigente' && (
            <span className="text-tinta-tenue"> · {textoDias(estado.dias)}</span>
          )}
        </dd>
        <dt className="text-tinta-suave">Cargado</dt>
        <dd>{fechaLarga(csd.cargadoAt)}</dd>
      </dl>
    </div>
  );
}

function TarjetaCsd({ empresaId, perfil }: { empresaId: string; perfil: PerfilFiscal | null }) {
  return (
    <Tarjeta titulo="Certificado de sello digital (CSD)">
      {perfil === null ? (
        <Vacio>Guarda primero los datos fiscales: el CSD se valida contra su RFC.</Vacio>
      ) : (
        <>
          {perfil.csd === null ? (
            <p className="mb-3 text-sm text-tinta-tenue" data-testid="sin-csd">
              Sin CSD cargado: sin él no se puede facturar. Hace falta el archivo .cer, el .key y la
              contraseña de la llave, que te entregó el SAT.
            </p>
          ) : (
            <Vigencia perfil={perfil} />
          )}
          <FormCsd empresaId={empresaId} reemplaza={perfil.csd !== null} rfc={perfil.rfc} />
        </>
      )}
    </Tarjeta>
  );
}

function FormCsd({
  empresaId,
  reemplaza,
  rfc,
}: {
  empresaId: string;
  reemplaza: boolean;
  rfc: string;
}) {
  const queryClient = useQueryClient();
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [contrasena, setContrasena] = useState('');
  // Cambiarlo vuelve a montar los <input type=file>: es la forma de vaciarlos.
  const [ronda, setRonda] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function limpiar() {
    setCer(null);
    setKey(null);
    setContrasena('');
    setRonda((n) => n + 1);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cer || !key || contrasena === '') {
      setError('Elige el .cer y el .key, y escribe la contraseña de la llave.');
      return;
    }
    if (cer.size > MAX_BYTES_ARCHIVO_CSD || key.size > MAX_BYTES_ARCHIVO_CSD) {
      setError('Un archivo pesa más de 16 KB: no parece un .cer o .key del SAT.');
      return;
    }
    setEnviando(true);
    try {
      const [certificado, llavePrivada] = await Promise.all([
        cer.arrayBuffer().then(aBase64),
        key.arrayBuffer().then(aBase64),
      ]);
      const r = await cargarCsd({ empresaId, certificado, llavePrivada, contrasena });
      queryClient.setQueryData([...LLAVE_FACTURACION, 'perfil', empresaId], r);
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      // La contraseña y los archivos no se quedan en el formulario, salga bien o mal.
      limpiar();
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      className="mt-4 grid gap-3 border-t border-linea-suave pt-4 sm:grid-cols-3"
    >
      <h3 className="text-sm font-medium sm:col-span-3">
        {reemplaza ? 'Reemplazar el CSD (renovación)' : `Subir el CSD de ${rfc}`}
      </h3>
      <label className={ETIQUETA}>
        <span>Certificado (.cer)</span>
        <input
          key={`cer-${ronda}`}
          type="file"
          accept=".cer"
          className="text-sm"
          onChange={(e) => setCer(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className={ETIQUETA}>
        <span>Llave privada (.key)</span>
        <input
          key={`key-${ronda}`}
          type="file"
          accept=".key"
          className="text-sm"
          onChange={(e) => setKey(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className={ETIQUETA}>
        <span>Contraseña de la llave</span>
        <input
          type="password"
          autoComplete="off"
          className={CONTROL}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
      </label>
      <p className={`${AYUDA} sm:col-span-3`}>
        La llave y su contraseña se mandan una sola vez al proveedor de timbrado y no se guardan en
        el panel.
      </p>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-3" data-testid="error-csd">
          {error}
        </p>
      )}
      <div className="sm:col-span-3">
        <button type="submit" className={PRIMARIO} disabled={enviando}>
          {enviando ? 'Validando…' : reemplaza ? 'Reemplazar CSD' : 'Subir CSD'}
        </button>
      </div>
    </form>
  );
}
