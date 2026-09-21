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

  it('documenta todos los endpoints (auth, agentes, ingesta, lectura y administración)', async () => {
    const { paths } = await generarDocumento();
    expect(Object.keys(paths).sort()).toEqual(
      [
        '/agente/yo',
        '/agentes/estado',
        '/auth/login',
        '/auth/me',
        '/auth/refresh',
        '/cuenta/password',
        '/empresas',
        '/empresas/{id}',
        '/ingesta/eventos',
        '/mesas/abiertas',
        '/sucursales',
        '/sucursales/{id}',
        '/sucursales/{id}/api-key',
        '/ventas/comparativo-sucursales',
        '/ventas/formas-pago',
        '/ventas/por-dia',
        '/ventas/por-hora',
        '/ventas/resumen',
        '/ventas/tickets',
        '/ventas/top-productos',
        '/usuarios',
        '/usuarios/{id}',
        '/usuarios/{id}/password',
      ].sort(),
    );
    expect(paths['/auth/login']?.post?.responses).toHaveProperty('429');
    expect(paths['/auth/me']?.get?.security).toEqual([{ bearer: [] }]);
  });

  it('documenta la administración (F1-060): 404 por alcance, 403 sólo por rol, y el cambio propio', async () => {
    const { paths } = await generarDocumento();
    const codigos = (op: { responses?: object } | undefined) =>
      Object.keys(op?.responses ?? {}).sort();
    expect(codigos(paths['/empresas']?.post)).toEqual(['201', '400', '401', '403']);
    expect(codigos(paths['/empresas/{id}']?.patch)).toEqual(['200', '400', '401', '403', '404']);
    expect(codigos(paths['/sucursales']?.post)).toEqual(['201', '400', '401', '403', '404']);
    expect(codigos(paths['/sucursales/{id}']?.patch)).toEqual(['200', '400', '401', '403', '404']);
    expect(codigos(paths['/usuarios']?.get)).toEqual(['200', '400', '401', '403', '404']);
    expect(codigos(paths['/usuarios']?.post)).toEqual(['201', '400', '401', '403', '404', '409']);
    expect(codigos(paths['/usuarios/{id}']?.patch)).toEqual(['200', '400', '401', '403', '404']);
    expect(codigos(paths['/usuarios/{id}/password']?.post)).toEqual([
      '204',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(codigos(paths['/cuenta/password']?.post)).toEqual(['200', '400', '401', '429']);
    for (const op of [paths['/usuarios']?.post, paths['/cuenta/password']?.post]) {
      expect(op?.security).toEqual([{ bearer: [] }]);
    }
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

  it('documenta el estado de agentes (F1-061): bearer, 403 del visor, 404 y el reloj de cada edad', async () => {
    const { paths, components } = await generarDocumento();
    const op = paths['/agentes/estado']?.get;
    expect(op?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(op?.responses ?? {}).sort()).toEqual(['200', '400', '401', '403', '404']);
    const esquema = JSON.stringify(components?.schemas?.EstadoAgenteSucursalDto);
    expect(esquema).toContain('reloj del SERVIDOR');
    expect(esquema).toContain('reloj de la PC del POS');
    const heartbeat = JSON.stringify(components?.schemas?.DatosHeartbeatDto);
    expect(heartbeat).toContain('tamanoCola');
    expect(paths['/ingesta/eventos']?.post?.description).toContain('CONTACTO');
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

  it('documenta la lectura (F1-033): Bearer en todo, 400/401/404 con filtro, y los esquemas', async () => {
    const { paths, components } = await generarDocumento();
    const conFiltro = [
      '/ventas/resumen',
      '/ventas/por-hora',
      '/ventas/por-dia',
      '/ventas/comparativo-sucursales',
      '/ventas/formas-pago',
      '/ventas/top-productos',
      '/ventas/tickets',
      '/mesas/abiertas',
      '/sucursales',
    ];
    for (const ruta of conFiltro) {
      const op = paths[ruta]?.get;
      expect(op?.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(op?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
    }
    const empresas = paths['/empresas']?.get;
    expect(empresas?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(empresas?.responses ?? {}).sort()).toEqual(['200', '401']);

    const nombres = (ruta: string) =>
      (paths[ruta]?.get?.parameters ?? []).map((p) => ('name' in p ? p.name : '')).sort();
    expect(nombres('/ventas/resumen')).toEqual(['desde', 'empresaId', 'hasta', 'sucursalId']);
    expect(nombres('/ventas/por-dia')).toEqual(['desde', 'empresaId', 'hasta', 'sucursalId']);
    expect(nombres('/ventas/comparativo-sucursales')).toEqual([
      'desde',
      'empresaId',
      'hasta',
      'sucursalId',
    ]);
    expect(nombres('/ventas/top-productos')).toEqual(
      ['desde', 'empresaId', 'hasta', 'limite', 'por', 'sucursalId'].sort(),
    );
    expect(nombres('/ventas/tickets')).toEqual(
      ['desde', 'empresaId', 'folio', 'hasta', 'pagina', 'porPagina', 'sucursalId'].sort(),
    );

    const esquemas = components?.schemas ?? {};
    // Un promedio sin divisor es null: el contrato lo dice.
    expect(JSON.stringify(esquemas.ResumenDto)).toMatch(/"ticketPromedio":\{[^}]*"nullable":true/);
    // La sucursal nunca expone su API key ni el hash.
    expect(Object.keys((esquemas.SucursalDto as { properties: object }).properties).sort()).toEqual(
      ['activo', 'empresaId', 'id', 'nombre', 'zonaHoraria'],
    );
    expect(JSON.stringify(esquemas)).not.toMatch(/apiKeyHash/);
    expect(esquemas).toHaveProperty('PaginaTicketsDto');
    expect(esquemas).toHaveProperty('MesasSucursalDto');
    expect(esquemas).toHaveProperty('VentaDiaDto');
    expect(JSON.stringify(esquemas.VentaSucursalDto)).toMatch(
      /"ticketPromedio":\{[^}]*"nullable":true/,
    );
  });
});
