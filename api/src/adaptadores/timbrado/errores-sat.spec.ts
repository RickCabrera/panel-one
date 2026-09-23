import { CAMPO_DE_ERROR, CODIGOS_SAT, errorSatConocido, MENSAJES_SAT } from './errores-sat';

/**
 * La tabla de errores del SAT (F2-104). Los textos de abajo imitan la matriz de errores del CFDI
 * 4.0 tal como la publica el SAT; que Facturama los reenvíe así se confirma en F2-190.
 */
describe('errorSatConocido() (F2-104)', () => {
  it.each([
    [
      'CFDI40144 - El campo Rfc del receptor no se encuentra en la lista de RFC inscritos no cancelados en el SAT.',
      'RFC_NO_INSCRITO',
      'rfc',
    ],
    [
      'CFDI40145: El campo Nombre del receptor, debe pertenecer al nombre asociado al RFC registrado en el campo Rfc del Receptor.',
      'NOMBRE_NO_COINCIDE',
      'razonSocial',
    ],
    [
      'CFDI40147 El campo DomicilioFiscalReceptor del receptor, debe pertenecer al nombre asociado al RFC registrado.',
      'CODIGO_POSTAL_NO_COINCIDE',
      'cp',
    ],
    [
      'CFDI40158 El campo RegimenFiscalReceptor, debe corresponder con el tipo de persona.',
      'REGIMEN_NO_CORRESPONDE',
      'regimenFiscal',
    ],
    [
      'CFDI40161 El campo UsoCFDI, debe corresponder con el tipo de persona.',
      'USO_CFDI_NO_APLICA',
      'usoCfdi',
    ],
  ])('por código y texto: %s', (texto, codigo, campo) => {
    expect(errorSatConocido(texto)).toEqual({
      codigo,
      campo,
      mensaje: MENSAJES_SAT[codigo as keyof typeof MENSAJES_SAT],
    });
  });

  it('sin código, por el atributo que cita el mensaje', () => {
    expect(errorSatConocido('Receiver.TaxZipCode: el código postal no es válido')?.codigo).toBe(
      'CODIGO_POSTAL_NO_COINCIDE',
    );
    expect(errorSatConocido('El campo RegimenFiscalReceptor no corresponde al RFC.')?.codigo).toBe(
      'REGIMEN_NO_CORRESPONDE',
    );
    expect(
      errorSatConocido('El RFC del receptor no existe en la lista de RFC inscritos no cancelados')
        ?.codigo,
    ).toBe('RFC_NO_INSCRITO');
    expect(errorSatConocido('El campo Nombre del receptor no coincide')?.codigo).toBe(
      'NOMBRE_NO_COINCIDE',
    );
  });

  it('el régimen y el CP del RECEPTOR no se confunden con su RFC o su nombre', () => {
    expect(
      errorSatConocido('El campo DomicilioFiscalReceptor no pertenece al RFC del receptor.')
        ?.codigo,
    ).toBe('CODIGO_POSTAL_NO_COINCIDE');
  });

  it('lo que no está en la tabla: null (la emisión contesta el mensaje genérico)', () => {
    expect(errorSatConocido('Serie inválida')).toBeNull();
    expect(errorSatConocido('')).toBeNull();
    expect(errorSatConocido('CFDI40999 algo que no conocemos')).toBeNull();
  });

  it('cada código de la matriz y cada mensaje llevan su campo del portal', () => {
    for (const e of Object.values(CODIGOS_SAT)) expect(CAMPO_DE_ERROR[e.codigo]).toBe(e.campo);
    for (const [codigo, mensaje] of Object.entries(MENSAJES_SAT)) {
      expect(CAMPO_DE_ERROR[codigo as keyof typeof CAMPO_DE_ERROR]).toBeDefined();
      expect(mensaje).toMatch(/[áéíóúñ]|SAT/);
    }
  });
});
