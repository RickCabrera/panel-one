import { RELOJ_FIJO, solicitudCfdi } from '../../../test/fixtures-cfdi';
import { validarReceptor } from '../../facturacion/portal';
import { ErrorTimbrado } from './puerto';
import {
  LEYENDA_NO_FISCAL,
  MENSAJE_CANCELACION_EN_PROCESO_PAC,
  MENSAJE_CSD_RECHAZADO,
  PLAZO_ACEPTACION_MS,
  RFC_CANCELACION_CON_ACEPTACION,
  MENSAJE_SUSTITUTO_NO_RELACIONADO,
  RFC_CON_ERROR,
  RFC_EMISOR_CSD_RECHAZADO,
  SELLO_FALSO,
  TimbradoFalso,
  uuidDeterminista,
} from './timbrado-falso';

const UUID_V4 = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

/**
 * Verificador mínimo de XML bien formado, sin dependencias: etiquetas balanceadas y
 * anidadas, atributos entre comillas sin `<` ni `&` suelto, y un solo elemento raíz.
 * Devuelve los elementos con sus atributos (ya desescapados) para las aserciones.
 */
function analizarXml(xml: string): Array<{ nombre: string; attrs: Record<string, string> }> {
  const cuerpo = xml
    .replace(/^<\?xml[^?]*\?>\s*/, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trim();
  const pila: string[] = [];
  const elementos: Array<{ nombre: string; attrs: Record<string, string> }> = [];
  // Los nombres de atributo aceptan letras con acento: el Anexo 20 tiene `Año` (F2-108).
  const token =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.\u00C0-\u00FF-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;
  let raices = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(cuerpo))) {
    pos = token.lastIndex;
    const [, cierre, nombre, attrsTxt, autocierre, texto] = m;
    if (texto !== undefined) {
      if (pila.length === 0 && texto.trim()) throw new Error('texto fuera de la raíz');
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(texto)) throw new Error('& suelto en texto');
      continue;
    }
    if (cierre) {
      if (pila.pop() !== nombre) throw new Error(`cierre desbalanceado: ${nombre}`);
      continue;
    }
    if (pila.length === 0) raices += 1;
    const attrs: Record<string, string> = {};
    for (const a of attrsTxt.matchAll(/([\w:.À-ÿ-]+)="([^"]*)"/g)) {
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(a[2])) throw new Error(`& suelto en ${a[1]}`);
      if (a[1] in attrs) throw new Error(`atributo repetido ${a[1]}`);
      attrs[a[1]] = a[2]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    }
    elementos.push({ nombre, attrs });
    if (!autocierre) pila.push(nombre);
  }
  if (pos !== cuerpo.length)
    throw new Error(`XML inválido cerca de: ${cuerpo.slice(pos, pos + 40)}`);
  if (pila.length > 0) throw new Error(`sin cerrar: ${pila.join(', ')}`);
  if (raices !== 1) throw new Error(`raíces: ${raices}`);
  return elementos;
}

function elemento(xml: string, nombre: string): Record<string, string> {
  const e = analizarXml(xml).find((x) => x.nombre === nombre);
  if (!e) throw new Error(`falta ${nombre}`);
  return e.attrs;
}

describe('PAC falso (F2-202)', () => {
  it('el verificador de XML del test sí muerde', () => {
    expect(() => analizarXml('<a><b></a></b>')).toThrow();
    expect(() => analizarXml('<a x="1 & 2"/>')).toThrow();
    expect(() => analizarXml('<a/><b/>')).toThrow();
    expect(() => analizarXml('<a x="1" x="2"/>')).toThrow();
    expect(analizarXml('<a x="&amp;"><b/></a>')).toHaveLength(2);
  });

  describe('UUID', () => {
    it('es un UUID v4 válido y el mismo cheque da siempre el mismo', async () => {
      const a = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      const b = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      expect(a.uuid).toMatch(UUID_V4);
      expect(b.uuid).toBe(a.uuid);
      expect(a.uuid).toBe(uuidDeterminista(solicitudCfdi().referencia));
      expect(a.idPac).toBe(a.uuid);
    });

    it('cheques distintos dan UUID distintos', async () => {
      const pac = new TimbradoFalso(RELOJ_FIJO);
      const uuids = new Set<string>();
      for (let i = 0; i < 200; i++) {
        uuids.add((await pac.emitir(solicitudCfdi({ referencia: `cheque-${i}` }))).uuid);
      }
      expect(uuids.size).toBe(200);
    });

    it('todo es determinista: mismo cheque y mismo reloj → mismo XML y mismo PDF', async () => {
      const a = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      const b = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      expect(b.xml).toBe(a.xml);
      expect(b.pdf.equals(a.pdf)).toBe(true);
      expect(a.fechaTimbrado.toISOString()).toBe('2026-09-22T02:20:00.000Z');
    });
  });

  describe('XML', () => {
    it('es CFDI 4.0 bien formado con los atributos que exige el SAT', async () => {
      const { xml, uuid } = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('NO FISCAL');

      const comprobante = elemento(xml, 'cfdi:Comprobante');
      expect(comprobante).toMatchObject({
        'xmlns:cfdi': 'http://www.sat.gob.mx/cfd/4',
        Version: '4.0',
        Serie: 'A',
        Folio: '1024',
        // Hora LOCAL del lugar de expedición, sin offset.
        Fecha: '2026-09-21T20:15:30',
        FormaPago: '04',
        MetodoPago: 'PUE',
        SubTotal: '202.59',
        Moneda: 'MXN',
        Total: '235.01',
        TipoDeComprobante: 'I',
        Exportacion: '01',
        LugarExpedicion: '06700',
        Sello: SELLO_FALSO,
      });
      expect(elemento(xml, 'cfdi:Emisor')).toEqual({
        Rfc: 'EKU9003173C9',
        Nombre: 'ESCUELA KEMPER URGATE',
        RegimenFiscal: '601',
      });
      expect(elemento(xml, 'cfdi:Receptor')).toEqual({
        Rfc: 'XOJI740919U48',
        // Escapado en el XML, idéntico al desescapar.
        Nombre: 'Cliente "de prueba" & <Hijos>',
        DomicilioFiscalReceptor: '76028',
        RegimenFiscalReceptor: '612',
        UsoCFDI: 'G03',
      });

      const elementos = analizarXml(xml);
      const conceptos = elementos.filter((e) => e.nombre === 'cfdi:Concepto');
      expect(conceptos.map((c) => c.attrs)).toEqual([
        {
          ClaveProdServ: '90101500',
          NoIdentificacion: 'P001',
          Cantidad: '2.000000',
          ClaveUnidad: 'E48',
          Unidad: 'Servicio',
          Descripcion: 'Tacos al pastor (orden)',
          ValorUnitario: '86.21',
          Importe: '172.42',
          ObjetoImp: '02',
        },
        expect.objectContaining({ NoIdentificacion: 'P020', Importe: '30.17' }),
      ]);
      const traslados = elementos.filter((e) => e.nombre === 'cfdi:Traslado').map((e) => e.attrs);
      // Uno por concepto + el resumen del comprobante.
      expect(traslados).toHaveLength(3);
      expect(traslados[2]).toEqual({
        Base: '202.59',
        Impuesto: '002',
        TipoFactor: 'Tasa',
        TasaOCuota: '0.160000',
        Importe: '32.42',
      });
      expect(
        elementos.find(
          (e) => e.nombre === 'cfdi:Impuestos' && 'TotalImpuestosTrasladados' in e.attrs,
        )?.attrs,
      ).toEqual({ TotalImpuestosTrasladados: '32.42' });

      expect(elemento(xml, 'tfd:TimbreFiscalDigital')).toMatchObject({
        Version: '1.1',
        UUID: uuid,
        FechaTimbrado: '2026-09-21T20:20:00',
        RfcProvCertif: 'FALSO',
        SelloSAT: SELLO_FALSO,
      });
    });

    it('la fecha sale en la zona de la sucursal, no en la del servidor', async () => {
      const { xml } = await new TimbradoFalso(RELOJ_FIJO).emitir(
        solicitudCfdi({ zonaHoraria: 'America/Tijuana' }),
      );
      // 02:15:30Z = 19:15:30 en Tijuana (UTC-7 en septiembre).
      expect(elemento(xml, 'cfdi:Comprobante').Fecha).toBe('2026-09-21T19:15:30');
    });
  });

  describe('PDF', () => {
    it('es un PDF válido marcado claramente como NO FISCAL', async () => {
      const { pdf, uuid } = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      const texto = pdf.toString('latin1');
      expect(texto.startsWith('%PDF-1.4\n')).toBe(true);
      expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(texto).toContain(`(${LEYENDA_NO_FISCAL})`);
      expect(texto).toContain(uuid);
      expect(texto).toContain('Total: $235.01 MXN');

      // La xref apunta al byte exacto donde empieza cada objeto.
      const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(texto)?.[1]);
      expect(texto.slice(startxref, startxref + 4)).toBe('xref');
      const entradas = [...texto.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
        Number(m[1]),
      );
      expect(entradas).toHaveLength(5);
      entradas.forEach((offset, i) => {
        expect(texto.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
      });
      // El /Length del stream es el largo real del contenido.
      const stream = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(texto);
      expect(Number(stream?.[1])).toBe(Buffer.byteLength(stream?.[2] ?? '', 'latin1'));
    });
  });

  describe('errores simulados por RFC reservado', () => {
    it.each(Object.entries(RFC_CON_ERROR))('%s → %s', async (rfc, esperado) => {
      const pac = new TimbradoFalso(RELOJ_FIJO);
      const base = solicitudCfdi();
      const promesa = pac.emitir({ ...base, receptor: { ...base.receptor, rfc } });
      await expect(promesa).rejects.toBeInstanceOf(ErrorTimbrado);
      await expect(promesa).rejects.toMatchObject({
        codigo: esperado.codigo,
        message: esperado.mensaje,
        reintentable: esperado.reintentable,
      });
    });

    it('XEXX010101000 da "RFC no inscrito"', () => {
      expect(RFC_CON_ERROR.XEXX010101000.codigo).toBe('RFC_NO_INSCRITO');
    });

    it('el RFC genérico de público en general (XAXX010101000) SÍ timbra: lo usa la global', async () => {
      const base = solicitudCfdi();
      await expect(
        new TimbradoFalso(RELOJ_FIJO).emitir({
          ...base,
          receptor: { ...base.receptor, rfc: 'XAXX010101000' },
        }),
      ).resolves.toHaveProperty('uuid');
    });
  });

  describe('cancelar y consultar', () => {
    it('emitido → vigente; cancelado → cancelado', async () => {
      const pac = new TimbradoFalso(RELOJ_FIJO);
      const cfdi = await pac.emitir(solicitudCfdi());
      await expect(pac.consultarEstado(cfdi)).resolves.toEqual({
        uuid: cfdi.uuid,
        estado: 'vigente',
      });
      await expect(pac.cancelar({ ...cfdi, motivo: '02' })).resolves.toEqual({
        uuid: cfdi.uuid,
        estado: 'cancelado',
        fecha: new Date(RELOJ_FIJO.ahora()),
      });
      await expect(pac.consultarEstado(cfdi)).resolves.toEqual({
        uuid: cfdi.uuid,
        estado: 'cancelado',
      });
    });

    it('un UUID que no emitió → no_encontrado, y cancelarlo falla', async () => {
      const pac = new TimbradoFalso(RELOJ_FIJO);
      const otro = { uuid: uuidDeterminista('nunca-emitido'), idPac: 'x' };
      await expect(pac.consultarEstado(otro)).resolves.toEqual({
        uuid: otro.uuid,
        estado: 'no_encontrado',
      });
      await expect(pac.cancelar({ ...otro, motivo: '02' })).rejects.toMatchObject({
        codigo: 'CFDI_NO_ENCONTRADO',
      });
    });

    it('motivo 01 sin folio de sustitución se rechaza', async () => {
      const pac = new TimbradoFalso(RELOJ_FIJO);
      const cfdi = await pac.emitir(solicitudCfdi());
      await expect(pac.cancelar({ ...cfdi, motivo: '01' })).rejects.toMatchObject({
        codigo: 'MOTIVO_REQUIERE_SUSTITUTO',
      });
      await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'vigente' });
    });
  });
});

describe('PAC falso: alta del CSD (F2-100)', () => {
  const csd = (rfc: string) => ({
    rfc,
    certificado: Buffer.from('cer'),
    llavePrivada: Buffer.from('key'),
    contrasena: 'x',
    reemplazar: false,
  });

  it('determinista: el id del emisor es su RFC, alta o reemplazo', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    await expect(pac.registrarCsd(csd('EKU9003173C9'))).resolves.toEqual({
      idOrganizacion: 'EKU9003173C9',
    });
    await expect(pac.registrarCsd({ ...csd('EKU9003173C9'), reemplazar: true })).resolves.toEqual({
      idOrganizacion: 'EKU9003173C9',
    });
  });

  it('el RFC reservado se rechaza con su mensaje', async () => {
    const promesa = new TimbradoFalso(RELOJ_FIJO).registrarCsd(csd(RFC_EMISOR_CSD_RECHAZADO));
    await expect(promesa).rejects.toBeInstanceOf(ErrorTimbrado);
    await expect(promesa).rejects.toMatchObject({
      codigo: 'CSD_RECHAZADO',
      message: MENSAJE_CSD_RECHAZADO,
      reintentable: false,
    });
  });
});

describe('PAC falso: sustitución (F2-107)', () => {
  const emitirSustituto = (pac: TimbradoFalso, anterior: string, referencia: string) =>
    pac.emitir({
      ...solicitudCfdi(),
      referencia,
      relacionados: { tipoRelacion: '04', uuids: [anterior] },
    });

  it('el XML del sustituto trae CfdiRelacionados 04 ANTES del Emisor, bien formado', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const anterior = await pac.emitir(solicitudCfdi());
    const nuevo = await emitirSustituto(pac, anterior.uuid, 'sustituto-1');
    const elementos = analizarXml(nuevo.xml).map((e) => e.nombre);
    const rel = elementos.indexOf('cfdi:CfdiRelacionados');
    expect(rel).toBeGreaterThan(0);
    expect(elementos[rel + 1]).toBe('cfdi:CfdiRelacionado');
    expect(elementos.indexOf('cfdi:Emisor')).toBeGreaterThan(rel);
    expect(nuevo.xml).toContain(
      `<cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="${anterior.uuid}"/>`,
    );
    expect(pac.relacionadosDe(nuevo.uuid)).toEqual({ tipoRelacion: '04', uuids: [anterior.uuid] });
    // Sin relacionados, nada.
    expect(anterior.xml).not.toContain('CfdiRelacionados');
  });

  it('motivo 01 con un sustituto que SÍ lo relaciona: cancela y guarda motivo y sustituto', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const anterior = await pac.emitir(solicitudCfdi());
    const nuevo = await emitirSustituto(pac, anterior.uuid, 'sustituto-1');
    await expect(
      pac.cancelar({ ...anterior, motivo: '01', folioSustitucion: nuevo.uuid }),
    ).resolves.toMatchObject({ uuid: anterior.uuid, estado: 'cancelado' });
    expect(pac.cancelacionDe(anterior.uuid)).toEqual({
      motivo: '01',
      folioSustitucion: nuevo.uuid,
    });
    await expect(pac.consultarEstado(nuevo)).resolves.toMatchObject({ estado: 'vigente' });
  });

  it('motivo 01 se RECHAZA si el sustituto no existe, no lo relaciona o ya no está vigente', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const anterior = await pac.emitir(solicitudCfdi());
    const ajeno = await pac.emitir({ ...solicitudCfdi(), referencia: 'otro-sin-relacion' });
    const rechazo = { codigo: 'RECHAZADO_POR_PAC', message: MENSAJE_SUSTITUTO_NO_RELACIONADO };
    // Inexistente.
    await expect(
      pac.cancelar({ ...anterior, motivo: '01', folioSustitucion: uuidDeterminista('nadie') }),
    ).rejects.toMatchObject(rechazo);
    // Existe pero no relaciona al anterior.
    await expect(
      pac.cancelar({ ...anterior, motivo: '01', folioSustitucion: ajeno.uuid }),
    ).rejects.toMatchObject(rechazo);
    // Relaciona, pero lo cancelaron antes.
    const nuevo = await emitirSustituto(pac, anterior.uuid, 'sustituto-1');
    await pac.cancelar({ ...nuevo, motivo: '02' });
    await expect(
      pac.cancelar({ ...anterior, motivo: '01', folioSustitucion: nuevo.uuid }),
    ).rejects.toMatchObject(rechazo);
    await expect(pac.consultarEstado(anterior)).resolves.toMatchObject({ estado: 'vigente' });
    expect(pac.cancelacionDe(anterior.uuid)).toBeUndefined();
  });
});

describe('PAC falso: factura global (F2-108)', () => {
  it('el XML trae InformacionGlobal como PRIMER hijo del Comprobante, bien formado', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const global = await pac.emitir({
      ...solicitudCfdi(),
      referencia: 'global-1',
      receptor: {
        rfc: 'XAXX010101000',
        nombre: 'PUBLICO EN GENERAL',
        usoCfdi: 'S01',
        regimenFiscal: '616',
        domicilioFiscal: '06700',
      },
      informacionGlobal: { periodicidad: '04', meses: '08', anio: 2026 },
    });
    const elementos = analizarXml(global.xml);
    const nombres = elementos.map((e) => e.nombre);
    expect(nombres[0]).toBe('cfdi:Comprobante');
    expect(nombres[1]).toBe('cfdi:InformacionGlobal');
    expect(elementos[1].attrs).toEqual({ Periodicidad: '04', Meses: '08', Año: '2026' });
    expect(nombres.indexOf('cfdi:Emisor')).toBeGreaterThan(1);
    // Sin global, no hay nodo.
    const normal = await pac.emitir(solicitudCfdi());
    expect(normal.xml).not.toContain('InformacionGlobal');
  });
});

describe('PAC falso: cancelación que espera al receptor (F2-109)', () => {
  const RECEPTOR_PORTAL = {
    razonSocial: 'PERSONA DE PRUEBA',
    regimenFiscal: '612',
    cp: '06700',
    usoCfdi: 'G03',
    email: 'prueba@ejemplo.test',
  };
  const emitirA = (pac: TimbradoFalso, rfc: string, referencia = `ref-${rfc}`) =>
    pac.emitir({
      ...solicitudCfdi(),
      referencia,
      receptor: { ...solicitudCfdi().receptor, rfc },
    });

  it('los dos RFC reservados pasan la validación del portal (persona física, no genéricos)', () => {
    for (const rfc of Object.values(RFC_CANCELACION_CON_ACEPTACION)) {
      expect(validarReceptor({ ...RECEPTOR_PORTAL, rfc })).toEqual({});
      expect(RFC_CON_ERROR[rfc]).toBeUndefined();
    }
  });

  it('con el receptor que ACEPTA: queda en_cancelacion hasta que responde; aceptar la cancela', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const cfdi = await emitirA(pac, RFC_CANCELACION_CON_ACEPTACION.acepta);
    await expect(pac.cancelar({ ...cfdi, motivo: '02' })).resolves.toEqual({
      uuid: cfdi.uuid,
      estado: 'en_cancelacion',
      fecha: new Date(RELOJ_FIJO.ahora()),
    });
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'en_cancelacion' });
    expect(pac.cancelacionDe(cfdi.uuid)).toBeUndefined();
    // Pedirla otra vez mientras espera: el PAC la rechaza.
    await expect(pac.cancelar({ ...cfdi, motivo: '02' })).rejects.toMatchObject({
      codigo: 'RECHAZADO_POR_PAC',
      message: MENSAJE_CANCELACION_EN_PROCESO_PAC,
    });
    pac.responderCancelacion(cfdi.uuid, 'aceptar');
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'cancelado' });
    expect(pac.cancelacionDe(cfdi.uuid)).toEqual({ motivo: '02' });
  });

  it('rechazar la regresa a vigente y se puede volver a pedir', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const cfdi = await emitirA(pac, RFC_CANCELACION_CON_ACEPTACION.acepta);
    await pac.cancelar({ ...cfdi, motivo: '03' });
    pac.responderCancelacion(cfdi.uuid, 'rechazar');
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'vigente' });
    await expect(pac.cancelar({ ...cfdi, motivo: '03' })).resolves.toMatchObject({
      estado: 'en_cancelacion',
    });
  });

  it('el receptor que RECHAZA lo hace en la primera consulta', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const cfdi = await emitirA(pac, RFC_CANCELACION_CON_ACEPTACION.rechaza);
    await expect(pac.cancelar({ ...cfdi, motivo: '02' })).resolves.toMatchObject({
      estado: 'en_cancelacion',
    });
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'vigente' });
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'vigente' });
  });

  it('sin respuesta a las 72 h procede (plazo del SAT), medido con el reloj del falso', async () => {
    const reloj = { t: RELOJ_FIJO.ahora(), ahora: () => reloj.t };
    const pac = new TimbradoFalso(reloj);
    const cfdi = await emitirA(pac, RFC_CANCELACION_CON_ACEPTACION.acepta);
    await pac.cancelar({ ...cfdi, motivo: '02' });
    reloj.t += PLAZO_ACEPTACION_MS - 1;
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'en_cancelacion' });
    reloj.t += 1;
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'cancelado' });
  });

  it('un receptor cualquiera cancela al instante, como antes (F2-104…F2-108 no cambian)', async () => {
    const pac = new TimbradoFalso(RELOJ_FIJO);
    const cfdi = await pac.emitir(solicitudCfdi());
    await expect(pac.cancelar({ ...cfdi, motivo: '02' })).resolves.toMatchObject({
      estado: 'cancelado',
    });
    pac.responderCancelacion(cfdi.uuid, 'rechazar');
    await expect(pac.consultarEstado(cfdi)).resolves.toMatchObject({ estado: 'cancelado' });
  });
});
