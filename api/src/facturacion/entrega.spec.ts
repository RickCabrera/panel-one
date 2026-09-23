import type { PuertoArchivos } from '../adaptadores/archivos/puerto';
import type { Adjunto, PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import type { Auditoria } from '../comun/auditoria';
import type { Reloj } from '../comun/reloj';
import type { ResultadoEnvio } from '../scope/escritura-facturacion';
import type { ScopedPrismaService } from '../scope/scoped-prisma.service';
import {
  adjuntosCfdi,
  claveArchivoCfdi,
  COLOR_CORREO_POR_DEFECTO,
  NOMBRE_PLANTILLA_FACTURA,
  plantillaFactura,
  textoDeError,
  tipoDeClaveCfdi,
} from './entrega';
import { EntregaCfdiService, type CfdiParaEntregar } from './entrega.service';

// La entrega de un CFDI (F2-105): lo PURO (clave, plantilla, adjuntos) y el servicio con dobles
// de los puertos y de las escrituras. Lo de verdad (Postgres, disco, HTTP) va en
// `entrega.e2e.spec.ts`.

const EMPRESA = '7d1f3c2a-0b4e-4c55-9a61-2f0e8b7c9d10';
const UUID = '5fb2822e-396d-4725-8521-cdc4bdd20ccf';

describe('claveArchivoCfdi', () => {
  it('cfdi/{empresa}/{AAAA}/{MM}/{UUID}.{ext}, con año y mes en la zona de la sucursal', () => {
    // 1 de octubre 03:00 UTC = 30 de septiembre 21:00 en CDMX: es de septiembre.
    const t = new Date('2026-10-01T03:00:00Z');
    expect(claveArchivoCfdi(EMPRESA, UUID, t, 'America/Mexico_City', 'xml')).toBe(
      `cfdi/${EMPRESA}/2026/09/${UUID.toUpperCase()}.xml`,
    );
    expect(claveArchivoCfdi(EMPRESA, UUID, t, 'UTC', 'pdf')).toBe(
      `cfdi/${EMPRESA}/2026/10/${UUID.toUpperCase()}.pdf`,
    );
  });

  it('tipoDeClaveCfdi: sólo XML/PDF bajo cfdi/', () => {
    expect(tipoDeClaveCfdi('cfdi/e/2026/09/A.xml')).toBe('application/xml');
    expect(tipoDeClaveCfdi('cfdi/e/2026/09/A.pdf')).toBe('application/pdf');
    expect(tipoDeClaveCfdi('cfdi/e/2026/09/A.html')).toBeNull();
    expect(tipoDeClaveCfdi('otra/e/A.pdf')).toBeNull();
    expect(tipoDeClaveCfdi('portal/cfdi/A.pdf')).toBeNull();
  });
});

describe('plantillaFactura y adjuntos', () => {
  const datos = {
    sucursal: 'Tacos <b>"El Güero"</b> & Cía',
    color: '#1D4ED8',
    emisor: 'ESCUELA KEMPER URGATE',
    uuid: UUID.toUpperCase(),
    serieFolio: 'A-1024',
    total: '12345.60',
  };

  it('escapa todo dato, formatea el total sobre el texto y usa el color del portal', () => {
    const p = plantillaFactura(datos);
    expect(p.nombre).toBe(NOMBRE_PLANTILLA_FACTURA);
    expect(p.asunto).toBe('Tu factura de Tacos <b>"El Güero"</b> & Cía (A-1024)');
    expect(p.html).not.toContain('<b>');
    expect(p.html).toContain('Tacos &lt;b&gt;&quot;El Güero&quot;&lt;/b&gt; &amp; Cía');
    expect(p.html).toContain('background:#1d4ed8;');
    expect(p.html).toContain('$12,345.60');
    expect(p.html).toContain(datos.uuid);
    expect(p.texto).toContain('Total: $12,345.60');
    expect(p.texto).toContain(`Folio fiscal (UUID): ${datos.uuid}`);
  });

  it('un color que no es #rrggbb no entra al HTML: usa el de por defecto', () => {
    for (const color of [null, 'red;background:url(x)', '#12345']) {
      const html = plantillaFactura({ ...datos, color }).html;
      expect(html).toContain(`background:${COLOR_CORREO_POR_DEFECTO};`);
      expect(html).not.toContain('url(x)');
    }
  });

  it('adjuntos: PDF y XML nombrados por serie y folio, con su tipo', () => {
    const [pdf, xml] = adjuntosCfdi('A-1024', Buffer.from('<x/>'), Buffer.from('%PDF'));
    expect(pdf).toMatchObject({ nombre: 'A-1024.pdf', tipo: 'application/pdf' });
    expect(xml).toMatchObject({ nombre: 'A-1024.xml', tipo: 'application/xml' });
    expect(xml.contenido.toString()).toBe('<x/>');
  });

  it('textoDeError: una línea, recortado, nunca vacío', () => {
    expect(textoDeError(new Error('a\n  b'), 500)).toBe('a b');
    expect(textoDeError(new Error('x'.repeat(900)), 500)).toHaveLength(500);
    expect(textoDeError(new Error(''), 500)).toMatch(/desconocido/);
  });
});

// ---------------------------------------------------------------------------------------------

const CFDI: CfdiParaEntregar = {
  empresaId: EMPRESA,
  cfdiId: 'cfdi-1',
  uuid: UUID.toUpperCase(),
  idPac: 'pac-1',
  serieFolio: 'A-12',
  total: '315.50',
  fechaTimbrado: new Date('2026-09-22T02:20:00Z'),
  zonaHoraria: 'America/Mexico_City',
  sucursal: 'Sucursal Sintética',
  colorPortal: null,
  emisor: 'ESCUELA KEMPER URGATE',
  xml: '<cfdi:Comprobante/>',
  pdf: Buffer.from('%PDF-1.4'),
};

function armar(
  opciones: {
    discoFalla?: boolean;
    correoFalla?: Error;
    sinEmail?: boolean;
  } = {},
) {
  const registro = {
    guardados: [] as string[],
    archivosRegistrados: 0,
    correos: [] as { email: string; plantilla: PlantillaCorreo; adjuntos: Adjunto[] }[],
    cierres: [] as ResultadoEnvio[],
  };
  const archivos: PuertoArchivos = {
    guardar: (clave) => {
      if (opciones.discoFalla) return Promise.reject(new Error('disco lleno'));
      registro.guardados.push(clave);
      return Promise.resolve();
    },
    leer: () => Promise.reject(new Error('no')),
    abrirLectura: () => Promise.reject(new Error('no')),
    urlFirmada: (clave) => Promise.resolve(`/api/archivos/${clave}?firma=f`),
    verificarUrl: () => false,
  };
  const correo: PuertoCorreo = {
    enviar: (destinatario, plantilla, adjuntos) => {
      if (opciones.correoFalla) return Promise.reject(opciones.correoFalla);
      registro.correos.push({ email: destinatario.email, plantilla, adjuntos });
      return Promise.resolve({ id: 'correo-1' });
    },
  };
  const escritura = {
    registrarArchivosCfdi: () => {
      registro.archivosRegistrados++;
      return Promise.resolve();
    },
    reclamarEnvioCfdi: () =>
      Promise.resolve(
        opciones.sinEmail
          ? null
          : { envioId: 'envio-1', email: 'cliente@ejemplo.test', intentos: 1 },
      ),
    cerrarEnvioCfdi: (_e: string, _id: string, r: ResultadoEnvio) => {
      registro.cierres.push(r);
      return Promise.resolve();
    },
  };
  const datos = { facturacion: () => escritura } as unknown as ScopedPrismaService;
  const reloj = { ahora: () => Date.parse('2026-09-22T02:21:00Z') } as Reloj;
  const auditoria = { registrar: () => undefined } as unknown as Auditoria;
  const servicio = new EntregaCfdiService(datos, reloj, auditoria, archivos, correo);
  return { servicio, registro };
}

describe('EntregaCfdiService.entregar (F2-105)', () => {
  const XML_CLAVE = `cfdi/${EMPRESA}/2026/09/${UUID.toUpperCase()}.xml`;
  const PDF_CLAVE = `cfdi/${EMPRESA}/2026/09/${UUID.toUpperCase()}.pdf`;

  it('todo bien: guarda los dos, los registra, da los enlaces y manda el correo con los dos', async () => {
    const { servicio, registro } = armar();
    await expect(servicio.entregar(CFDI)).resolves.toEqual({
      xml: `/api/archivos/${XML_CLAVE}?firma=f`,
      pdf: `/api/archivos/${PDF_CLAVE}?firma=f`,
    });
    expect(registro.guardados).toEqual([XML_CLAVE, PDF_CLAVE]);
    expect(registro.archivosRegistrados).toBe(1);
    expect(registro.correos).toHaveLength(1);
    expect(registro.correos[0].email).toBe('cliente@ejemplo.test');
    expect(registro.correos[0].plantilla.nombre).toBe('factura-emitida');
    expect(registro.correos[0].adjuntos.map((a) => a.nombre)).toEqual(['A-12.pdf', 'A-12.xml']);
    expect(registro.cierres).toEqual([{ ok: true, correoId: 'correo-1' }]);
  });

  it('el disco falla: sin enlaces, pero el correo sale con los archivos EN MEMORIA', async () => {
    const { servicio, registro } = armar({ discoFalla: true });
    await expect(servicio.entregar(CFDI)).resolves.toEqual({ xml: null, pdf: null });
    expect(registro.archivosRegistrados).toBe(0);
    expect(registro.correos).toHaveLength(1);
    const [pdf, xml] = registro.correos[0].adjuntos;
    expect(pdf.contenido.equals(CFDI.pdf)).toBe(true);
    expect(xml.contenido.toString('utf8')).toBe(CFDI.xml);
  });

  it('el correo falla: NO lanza, el envío queda fallido con el error y los enlaces siguen', async () => {
    const { servicio, registro } = armar({
      correoFalla: new Error('El servicio de correo rechazó el envío (HTTP 500).'),
    });
    const descargas = await servicio.entregar(CFDI);
    expect(descargas.xml).not.toBeNull();
    expect(registro.cierres).toEqual([
      { ok: false, error: 'El servicio de correo rechazó el envío (HTTP 500).' },
    ]);
  });

  it('una zona horaria inválida no tumba la entrega: sin archivos, el correo sale igual', async () => {
    const { servicio, registro } = armar();
    await expect(servicio.entregar({ ...CFDI, zonaHoraria: 'Zona/Inventada' })).resolves.toEqual({
      xml: null,
      pdf: null,
    });
    expect(registro.guardados).toEqual([]);
    expect(registro.correos).toHaveLength(1);
  });

  it('disco Y correo fallan: no lanza (el CFDI ya existe ante el SAT)', async () => {
    const { servicio } = armar({ discoFalla: true, correoFalla: new Error('caído') });
    await expect(servicio.entregar(CFDI)).resolves.toEqual({ xml: null, pdf: null });
  });

  it('receptor sin correo (F2-107 futura): no hay envío y el puerto de correo ni se llama', async () => {
    const { servicio, registro } = armar({ sinEmail: true });
    await servicio.entregar(CFDI);
    expect(registro.correos).toEqual([]);
    expect(registro.cierres).toEqual([]);
  });
});
