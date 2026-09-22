import { Prisma } from '@prisma/client';

import { decidirFoto, hayCambios, normalizarFoto, valorDe } from './existencias';

const D = (v: string) => new Prisma.Decimal(v);

describe('ingesta de existencias (pura, F2-121)', () => {
  describe('valorDe', () => {
    it('round(cantidad × costo, 2) mitad lejos de cero, también en negativos', () => {
      expect(valorDe(D('0.125'), D('1.00'))!.toFixed(2)).toBe('0.13');
      expect(valorDe(D('-0.125'), D('1.00'))!.toFixed(2)).toBe('-0.13');
      expect(valorDe(D('5.5'), D('3.33'))!.toFixed(2)).toBe('18.32');
      expect(valorDe(D('0.001'), D('0.01'))!.toFixed(2)).toBe('0.00');
      expect(valorDe(D('-0.001'), D('0.01'))!.isNegative()).toBe(false);
    });

    it('lo que no cabe en NUMERIC(12,2) = null', () => {
      expect(valorDe(D('999999999.999'), D('9999999999.99'))).toBeNull();
      expect(valorDe(D('1000000'), D('10000'))).toBeNull();
      expect(valorDe(D('999999'), D('10000'))!.toFixed(2)).toBe('9999990000.00');
    });
  });

  describe('normalizarFoto', () => {
    it('costo a 2 decimales antes del valor; cantidad tal cual (hasta 3)', async () => {
      const { validos, rechazos } = await normalizarFoto([
        { insumoOrigenSrId: 'I1', cantidad: '3.5', costoPromedio: '2.3333' },
        { insumoOrigenSrId: 'I2', cantidad: '-2', costoPromedio: '10.5' },
      ]);
      expect(rechazos).toEqual([]);
      expect(
        validos.map((v) => [v.cantidad.toFixed(3), v.costoPromedio.toFixed(2), v.valor.toFixed(2)]),
      ).toEqual([
        ['3.500', '2.33', '8.16'],
        ['-2.000', '10.50', '-21.00'],
      ]);
    });

    it('rechaza por registro, con ruta y SIN el valor; repetidos en todas sus apariciones', async () => {
      const { validos, rechazos } = await normalizarFoto([
        { insumoOrigenSrId: 'I1', cantidad: '1.2345', costoPromedio: '1' },
        { insumoOrigenSrId: 'I2', cantidad: '1', costoPromedio: 'caro' },
        { insumoOrigenSrId: 'I3', cantidad: '1', costoPromedio: '1', sucursalId: 'x' },
        { insumoOrigenSrId: 'I4', cantidad: '1', costoPromedio: '1' },
        { insumoOrigenSrId: 'I4', cantidad: '2', costoPromedio: '1' },
        { cantidad: '1', costoPromedio: '1' },
        { insumoOrigenSrId: 'I5', cantidad: '1', costoPromedio: '1' },
      ]);
      expect(validos.map((v) => v.insumoOrigenSrId)).toEqual(['I5']);
      expect(rechazos.map((r) => [r.indice, r.insumoOrigenSrId])).toEqual([
        [0, 'I1'],
        [1, 'I2'],
        [2, 'I3'],
        [3, 'I4'],
        [4, 'I4'],
        [5, null],
      ]);
      expect(rechazos[0].motivo).toContain('registros.0.cantidad');
      expect(rechazos[1].motivo).toContain('registros.1.costoPromedio');
      expect(rechazos[1].motivo).not.toContain('caro');
      expect(rechazos[2].motivo).toContain('registros.2.sucursalId');
      expect(rechazos[3].motivo).toContain('repetido');
    });

    it('costo que al redondear no cabe, o valor que no cabe: rechazo con motivo', async () => {
      const { rechazos } = await normalizarFoto([
        { insumoOrigenSrId: 'I1', cantidad: '1', costoPromedio: '9999999999.9999' },
        { insumoOrigenSrId: 'I2', cantidad: '999999999', costoPromedio: '9999999' },
      ]);
      expect(rechazos.map((r) => r.motivo)).toEqual([
        'registros.0.costoPromedio: no cabe en NUMERIC(12,2) al redondear',
        'registros.1: cantidad × costoPromedio no cabe en NUMERIC(12,2)',
      ]);
    });
  });

  describe('decidirFoto', () => {
    const guardada = (id: string, insumo: string, cantidad = '1', costo = '1', valor = '1') => ({
      id,
      insumoOrigenSrId: insumo,
      cantidad: D(cantidad),
      costoPromedio: D(costo),
      valor: D(valor),
    });
    const valido = (insumo: string, cantidad = '1', costo = '1', valor = '1') => ({
      indice: 0,
      insumoOrigenSrId: insumo,
      cantidad: D(cantidad),
      costoPromedio: D(costo),
      valor: D(valor),
    });
    const rechazo = (insumo: string | null) => ({
      indice: 9,
      insumoOrigenSrId: insumo,
      motivo: 'x',
      reintentable: false,
    });

    it('crea, actualiza, deja igual (1 = 1.000) y borra ausentes', () => {
      const plan = decidirFoto({
        existentes: [guardada('a', 'I1'), guardada('b', 'I2'), guardada('c', 'I3')],
        validos: [valido('I1', '1.000', '1.00', '1.00'), valido('I2', '2', '1', '2'), valido('I4')],
        rechazos: [],
      });
      expect(plan.crear.map((r) => r.insumoOrigenSrId)).toEqual(['I4']);
      expect(plan.actualizar.map((a) => a.id)).toEqual(['b']);
      expect(plan.sinCambios).toBe(1);
      expect(plan.borrar).toEqual(['c']);
      expect(hayCambios(plan)).toBe(true);
    });

    it('un rechazado con insumo conserva su fila; sin insumo, no se borra ningún ausente', () => {
      const existentes = [guardada('a', 'I1'), guardada('b', 'I2')];
      const conId = decidirFoto({ existentes, validos: [], rechazos: [rechazo('I1')] });
      expect(conId).toMatchObject({ borrar: ['b'], conservados: 1, ausentesConservados: false });
      const sinId = decidirFoto({ existentes, validos: [], rechazos: [rechazo(null)] });
      expect(sinId).toMatchObject({ borrar: [], conservados: 0, ausentesConservados: true });
      expect(hayCambios(sinId)).toBe(false);
    });

    it('un reenvío idéntico no tiene cambios', () => {
      const plan = decidirFoto({
        existentes: [guardada('a', 'I1')],
        validos: [valido('I1')],
        rechazos: [],
      });
      expect(hayCambios(plan)).toBe(false);
    });
  });
});
