import { describe, expect, it } from 'vitest';

import { MAX_TEXTO_EXCEL, texto, textoExcel } from './csv';

// Las dos capas de escape de `textoExcel`, con el campo CSV COMPLETO: primero las
// comillas se doblan dentro del literal de la fórmula, luego otra vez para el CSV.
describe('textoExcel', () => {
  it('un folio numérico queda como literal de texto, ceros incluidos', () => {
    expect(textoExcel('000123')).toBe('"=""000123"""');
    expect(textoExcel('12345678901234567890')).toBe('"=""12345678901234567890"""');
  });

  it('un intento de cerrar el literal con comillas no escapa de él', () => {
    // En Excel: ="1"" & HYPERLINK(""http://x"") & """ → el texto 1" & HYPERLINK("http://x") & "
    expect(textoExcel('1" & HYPERLINK("http://x") & "')).toBe(
      '"=""1"""" & HYPERLINK(""""http://x"""") & """""""',
    );
  });

  it('lo que empieza como fórmula también va dentro del literal', () => {
    expect(textoExcel('=1+1')).toBe('"=""=1+1"""');
    expect(textoExcel('-5')).toBe('"=""-5"""');
    expect(textoExcel('@SUM(A1)')).toBe('"=""@SUM(A1)"""');
  });

  it('con salto de línea o demasiado largo cae a texto() (la regla del apóstrofo)', () => {
    expect(textoExcel('=12\n34')).toBe(texto('=12\n34'));
    expect(textoExcel('=12\n34')).toBe(`"'=12\n34"`);
    const largo = '9'.repeat(MAX_TEXTO_EXCEL + 1);
    expect(textoExcel(largo)).toBe(largo);
    const justo = '9'.repeat(MAX_TEXTO_EXCEL);
    expect(textoExcel(justo)).toBe(`"=""${justo}"""`);
  });

  it('null queda vacío', () => {
    expect(textoExcel(null)).toBe('');
  });
});
