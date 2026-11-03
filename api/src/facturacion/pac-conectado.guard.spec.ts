import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { MENSAJE_FACTURACION_NO_CONECTADA } from '../adaptadores/timbrado/timbrado-no-conectado';
import { CancelacionController } from './cancelacion.controller';
import { ConciliacionController } from './conciliacion.controller';
import { EmisionAdminController } from './emision-admin.controller';
import { FacturacionController } from './facturacion.controller';
import { FacturaGlobalController } from './global.controller';
import { PacConectadoGuard } from './pac-conectado.guard';
import { PortalPublicoController } from './portal.controller';

// Producción SIN PAC (deploy en Railway con PAC_IMPL=falso permitido): ninguna ruta simula un
// CFDI. El guard contesta 503 con el mensaje claro; aquí se prueba el guard y que TODA ruta que
// timbra, cancela o registra un CSD lo lleve puesto.
describe('PacConectadoGuard', () => {
  it('sin PAC conectado → 503 con "La facturación no está conectada todavía"', () => {
    const guard = new PacConectadoGuard(true);
    let error: unknown;
    try {
      guard.canActivate();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).message).toBe(MENSAJE_FACTURACION_NO_CONECTADA);
    expect(MENSAJE_FACTURACION_NO_CONECTADA).toMatch(/^La facturación no está conectada todavía/);
  });

  it('con PAC conectado (o fuera de producción) deja pasar', () => {
    expect(new PacConectadoGuard(false).canActivate()).toBe(true);
  });

  type Ruta = [string, object, string];
  const rutas: Ruta[] = [
    [
      'POST /facturacion/portal/:slug/facturas',
      PortalPublicoController.prototype,
      'solicitarFactura',
    ],
    ['POST /facturacion/cfdis/manual', EmisionAdminController.prototype, 'manual'],
    ['POST /facturacion/cfdis/:id/refacturar', EmisionAdminController.prototype, 'refacturar'],
    ['POST /facturacion/global', FacturaGlobalController.prototype, 'emitir'],
    ['POST /facturacion/cfdis/:id/cancelar', CancelacionController.prototype, 'cancelar'],
    [
      'POST /facturacion/cfdis/:id/cancelacion/consultar',
      CancelacionController.prototype,
      'consultar',
    ],
    ['POST /facturacion/perfil-fiscal/csd', FacturacionController.prototype, 'cargarCsd'],
  ];

  function guardsDe(prototipo: object, metodo: string): unknown[] {
    const fn = (prototipo as Record<string, unknown>)[metodo];
    return (Reflect.getMetadata(GUARDS_METADATA, fn as object) as unknown[] | undefined) ?? [];
  }

  it.each(rutas)('%s lleva PacConectadoGuard', (_ruta, prototipo, metodo) => {
    expect(guardsDe(prototipo, metodo)).toContain(PacConectadoGuard);
  });

  it('la conciliación NO se corta: cuenta los fallos del PAC sin simular nada', () => {
    expect(guardsDe(ConciliacionController.prototype, 'conciliar')).not.toContain(
      PacConectadoGuard,
    );
  });
});
