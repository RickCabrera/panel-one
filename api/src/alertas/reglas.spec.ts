import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TipoAlerta } from '@prisma/client';

import { intervaloAlertasS } from './programador';
import { definicion, REGLAS, reglasEfectivas, SNAPSHOT_VIVO_S } from './reglas';

// El archivo del web del que el API es espejo. El monorepo se clona completo (también en CI):
// si no está, el test FALLA con el porqué, no se salta.
const REGLAS_WEB = join(__dirname, '..', '..', '..', 'web', 'src', 'paginas', 'mesas', 'reglas.ts');

describe('reglas del centro de alertas', () => {
  it('cubre todos los tipos, cada uno una vez, con su default dentro del rango', () => {
    expect(REGLAS.map((r) => r.tipo).sort()).toEqual(Object.values(TipoAlerta).sort());
    for (const r of REGLAS) {
      expect(r.porDefecto).toBeGreaterThanOrEqual(r.minimo);
      expect(r.porDefecto).toBeLessThanOrEqual(r.maximo);
    }
  });

  it('defaults de la ficha: 10 min sin reporte, 60 min de mesa, 30 min sin imprimir', () => {
    expect(definicion(TipoAlerta.sucursal_sin_reporte).porDefecto).toBe(10);
    expect(definicion(TipoAlerta.mesa_abierta).porDefecto).toBe(60);
    expect(definicion(TipoAlerta.cuenta_sin_imprimir).porDefecto).toBe(30);
  });

  it('bajo mínimo (F2-121): % del mínimo, 100 por defecto, advertencia', () => {
    expect(definicion(TipoAlerta.bajo_minimo)).toMatchObject({
      unidad: 'porcentaje',
      minimo: 1,
      maximo: 100,
      porDefecto: 100,
      severidad: 'advertencia',
    });
  });

  it('reglasEfectivas: lo guardado gana; sin fila, el default activo', () => {
    const r = reglasEfectivas([{ tipo: TipoAlerta.mesa_abierta, activa: false, umbral: 90 }]);
    expect(r.find((x) => x.tipo === TipoAlerta.mesa_abierta)).toEqual({
      tipo: TipoAlerta.mesa_abierta,
      activa: false,
      umbral: 90,
      porDefecto: false,
    });
    expect(r.find((x) => x.tipo === TipoAlerta.caida_venta)).toEqual({
      tipo: TipoAlerta.caida_venta,
      activa: true,
      umbral: 30,
      porDefecto: true,
    });
  });

  describe('espejo del web (web/src/paginas/mesas/reglas.ts)', () => {
    it('el archivo del web existe', () => {
      if (!existsSync(REGLAS_WEB)) {
        throw new Error(
          `No está ${REGLAS_WEB}: el espejo de SNAPSHOT_VIVO_S no se puede verificar.`,
        );
      }
    });

    it('SNAPSHOT_VIVO_S = 3 × INTERVALO_AGENTE_S del web', () => {
      const web = readFileSync(REGLAS_WEB, 'utf8');
      const intervalo = /export const INTERVALO_AGENTE_S = (\d+);/.exec(web);
      expect(intervalo).not.toBeNull();
      expect(web).toMatch(/export const UMBRAL_DESCONEXION_S = 3 \* INTERVALO_AGENTE_S;/);
      expect(SNAPSHOT_VIVO_S).toBe(3 * Number(intervalo![1]));
    });

    it('el default de mesa_abierta es el borde del semáforo rojo del web (> 60)', () => {
      const web = readFileSync(REGLAS_WEB, 'utf8');
      const borde = /if \(minutos <= (\d+)\) return 'alerta';/.exec(web);
      expect(borde).not.toBeNull();
      expect(definicion(TipoAlerta.mesa_abierta).porDefecto).toBe(Number(borde![1]));
    });
  });
});

describe('intervaloAlertasS', () => {
  it('default 60, apagado en test, 0 apaga, basura truena', () => {
    expect(intervaloAlertasS({})).toBe(60);
    expect(intervaloAlertasS({ NODE_ENV: 'test' })).toBe(0);
    expect(intervaloAlertasS({ ALERTAS_INTERVALO_S: '0' })).toBe(0);
    expect(intervaloAlertasS({ ALERTAS_INTERVALO_S: '15', NODE_ENV: 'test' })).toBe(15);
    expect(() => intervaloAlertasS({ ALERTAS_INTERVALO_S: '-1' })).toThrow(/ALERTAS_INTERVALO_S/);
    expect(() => intervaloAlertasS({ ALERTAS_INTERVALO_S: 'x' })).toThrow(/ALERTAS_INTERVALO_S/);
  });
});
