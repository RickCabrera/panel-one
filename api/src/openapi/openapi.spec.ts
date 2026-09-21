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

  it('documenta todos los endpoints (auth, agentes e ingesta)', async () => {
    const { paths } = await generarDocumento();
    expect(Object.keys(paths).sort()).toEqual([
      '/agente/yo',
      '/auth/login',
      '/auth/me',
      '/auth/refresh',
      '/ingesta/eventos',
      '/sucursales/{id}/api-key',
    ]);
    expect(paths['/auth/login']?.post?.responses).toHaveProperty('429');
    expect(paths['/auth/me']?.get?.security).toEqual([{ bearer: [] }]);
  });

  it('documenta la auth de agentes (F1-012): la rotación con bearer y /agente/yo con X-Api-Key', async () => {
    const { paths, components } = await generarDocumento();
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining(['/sucursales/{id}/api-key', '/agente/yo']),
    );
    const rotar = paths['/sucursales/{id}/api-key']?.post;
    expect(rotar?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(rotar?.responses ?? {}).sort()).toEqual(['201', '400', '401', '403', '404']);
    const yo = paths['/agente/yo']?.get;
    expect(yo?.security).toEqual([{ agente: [] }]);
    expect(Object.keys(yo?.responses ?? {}).sort()).toEqual(['200', '401', '429']);
    expect(components?.securitySchemes?.agente).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-Api-Key',
    });
  });

  it('documenta la ingesta (F1-031): X-Api-Key, 200 con procesados/rechazados, 400, 413 y los tres tipos de evento', async () => {
    const { paths, components } = await generarDocumento();
    const ingesta = paths['/ingesta/eventos']?.post;
    expect(ingesta?.security).toEqual([{ agente: [] }]);
    expect(Object.keys(ingesta?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '413',
      '429',
    ]);
    const esquemas = components?.schemas ?? {};
    expect(esquemas).toHaveProperty('EventoChequeDto');
    expect(esquemas).toHaveProperty('EventoSnapshotDto');
    expect(esquemas).toHaveProperty('EventoHeartbeatDto');
    expect(JSON.stringify(esquemas.RechazoDto)).toContain('reintentable');
    // El agente nunca manda tenant: ningún esquema de la ingesta lo acepta.
    const deIngesta = ['DatosChequeDto', 'DatosSnapshotDto', 'DatosHeartbeatDto', 'LoteIngestaDto'];
    for (const nombre of deIngesta) {
      const texto = JSON.stringify(esquemas[nombre]);
      expect(texto).not.toContain('sucursalId');
      expect(texto).not.toContain('empresaId');
    }
  });
});
