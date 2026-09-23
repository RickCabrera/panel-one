import type { PrismaService } from '../prisma/prisma.service';
import { ScopedPrismaService } from './scoped-prisma.service';

// Las lecturas PÚBLICAS del portal de autofactura (F2-103) en el helper de scope: sin tenant,
// pero con su filtro ADENTRO (no "acordándose" en el servicio). Se fija el WHERE que llega a
// Prisma con un cliente falso.

function clienteFalso() {
  const llamadas: { modelo: string; args: { where: object; select: object } }[] = [];
  const delegado = (modelo: string, fila: unknown) => ({
    findFirst: (args: { where: object; select: object }) => {
      llamadas.push({ modelo, args });
      return Promise.resolve(fila);
    },
  });
  const prisma = {
    portalFacturacion: delegado('portalFacturacion', null),
    codigoFacturacion: delegado('codigoFacturacion', null),
  };
  return { helper: new ScopedPrismaService(prisma as unknown as PrismaService), llamadas };
}

const VISIBLE = { activo: true, sucursal: { activo: true, empresa: { activo: true } } };

describe('ScopedPrismaService: lecturas públicas del portal (F2-103)', () => {
  it('portalPublico y logoPortal filtran portal, sucursal y empresa activos', async () => {
    const { helper, llamadas } = clienteFalso();
    expect(await helper.portalPublico('demo-centro')).toBeNull();
    expect(await helper.logoPortal('demo-centro')).toBeNull();
    for (const l of llamadas) {
      expect(l.args.where).toEqual({ slug: 'demo-centro', ...VISIBLE });
    }
    // La marca NO trae los bytes del logo.
    expect(llamadas[0].args.select).not.toHaveProperty('logo');
  });

  it('codigoFacturacionDelPortal pone la empresa EN el WHERE', async () => {
    const { helper, llamadas } = clienteFalso();
    await helper.codigoFacturacionDelPortal('7JQRECP3U', 'empresa-1');
    expect(llamadas[0].args.where).toEqual({ codigo: '7JQRECP3U', empresaId: 'empresa-1' });
    // Lista blanca: ni folio, ni mesa, ni mesero, ni partidas.
    const select = JSON.stringify(llamadas[0].args.select);
    for (const prohibido of ['folio', 'mesa', 'mesero', 'partidas', 'pagos']) {
      expect(select).not.toContain(`"${prohibido}"`);
    }
  });

  it('F2-108: de la factura global del ticket sólo sale su estado y su periodo (lista blanca)', async () => {
    const { helper, llamadas } = clienteFalso();
    await helper.codigoFacturacionDelPortal('7JQRECP3U', 'empresa-1');
    await helper.codigoFacturacionPublico('7JQRECP3U');
    expect(llamadas).toHaveLength(2);
    for (const l of llamadas) {
      const global = (l.args.select as { global?: unknown }).global;
      // Exactamente esto: ni uuid, ni serie, ni folio, ni total, ni receptor de la global, ni el
      // total del ticket guardado en `cfdi_global_codigos` (la venta mensual al público).
      expect(global).toEqual({
        select: { cfdi: { select: { estado: true, globalPeriodicidad: true, globalDesde: true } } },
      });
      const texto = JSON.stringify(global);
      for (const prohibido of ['uuid', 'serie', 'folio', 'total', 'receptor', 'subtotal', 'iva']) {
        expect(texto).not.toContain(`"${prohibido}"`);
      }
    }
  });

  it.each([
    ['empresa vacía', '7JQRECP3U', ''],
    ['empresa ausente', '7JQRECP3U', undefined],
    ['código vacío', '', 'empresa-1'],
  ])('%s: truena antes de consultar (nunca "todas las empresas")', (_caso, codigo, empresaId) => {
    const { helper, llamadas } = clienteFalso();
    expect(() => helper.codigoFacturacionDelPortal(codigo, empresaId as string)).toThrow(
      /vacío o ausente/,
    );
    expect(llamadas).toHaveLength(0);
  });

  it('un slug vacío también truena', async () => {
    const { helper } = clienteFalso();
    await expect(helper.portalPublico('')).rejects.toThrow(/vacío o ausente/);
    await expect(helper.logoPortal('')).rejects.toThrow(/vacío o ausente/);
  });
});
