import { readFileSync } from 'node:fs';

import { generarDocumento, RUTA_OPENAPI, serializar } from './documento';

// El contrato versionado (`api/openapi.json`) no puede divergir del código: si
// alguien cambia un endpoint o un DTO y no corre `npm run openapi`, esto falla.
describe('Contrato OpenAPI', () => {
  it('api/openapi.json es exactamente el documento que genera el código', async () => {
    const generado = await generarDocumento();
    // Se compara el JSON parseado (no depende de CRLF/LF del checkout) y además
    // el texto con finales normalizados (atrapa un archivo editado a mano).
    const versionado = readFileSync(RUTA_OPENAPI, 'utf8');
    expect(JSON.parse(versionado)).toEqual(JSON.parse(serializar(generado)));
    expect(versionado.replace(/\r\n/g, '\n')).toBe(serializar(generado));
  });

  it('documenta los endpoints de auth', async () => {
    const { paths } = await generarDocumento();
    expect(Object.keys(paths).sort()).toEqual(['/auth/login', '/auth/me', '/auth/refresh']);
    expect(paths['/auth/login']?.post?.responses).toHaveProperty('429');
    expect(paths['/auth/me']?.get?.security).toEqual([{ bearer: [] }]);
  });
});
