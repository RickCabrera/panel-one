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

  it('centro de alertas (F2-224): códigos, roles y dinero como texto en el detalle', async () => {
    const { paths } = await generarDocumento();
    const codigos = (op?: { responses?: object }) => Object.keys(op?.responses ?? {}).sort();
    expect(codigos(paths['/alertas/abiertas']?.get)).toEqual(['200', '400', '401', '404']);
    expect(codigos(paths['/alertas/historial']?.get)).toEqual(['200', '400', '401', '404']);
    expect(codigos(paths['/alertas/reglas']?.get)).toEqual(['200', '400', '401', '404']);
    expect(codigos(paths['/alertas/reglas/{tipo}']?.put)).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '503',
    ]);
    expect(paths['/alertas/reglas/{tipo}']?.put?.description).toContain('misma transacción');
    expect(JSON.stringify(paths['/alertas/abiertas'])).toContain('AlertaDto');
  });

  it('reportes por correo (F2-141): baja pública con límite, el resto con token y 404', async () => {
    const { paths } = await generarDocumento();
    const codigos = (op?: { responses?: object }) => Object.keys(op?.responses ?? {}).sort();
    expect(codigos(paths['/cuenta/reportes']?.get)).toEqual(['200', '400', '401', '404']);
    expect(codigos(paths['/cuenta/reportes']?.put)).toEqual(['200', '400', '401', '404']);
    expect(codigos(paths['/cuenta/reportes/vista-previa']?.get)).toEqual([
      '200',
      '400',
      '401',
      '404',
    ]);
    expect(codigos(paths['/reportes/baja']?.post)).toEqual(['200', '400', '404', '429']);
    expect(paths['/reportes/baja']?.post?.security).toBeUndefined();
    expect(paths['/cuenta/reportes']?.get?.security).toEqual([{ bearer: [] }]);
  });

  it('catálogos espejo (F2-230): agente con API key y reintentos claros; panel con 404 y roles', async () => {
    const { paths } = await generarDocumento();
    const codigos = (op?: { responses?: object }) => Object.keys(op?.responses ?? {}).sort();
    expect(codigos(paths['/ingesta/catalogos']?.post)).toEqual([
      '200',
      '400',
      '401',
      '429',
      '500',
      '503',
    ]);
    expect(codigos(paths['/ingesta/catalogos/cierre']?.post)).toEqual([
      '200',
      '400',
      '401',
      '409',
      '429',
      '500',
      '503',
    ]);
    expect(codigos(paths['/ingesta/catalogos/solicitud']?.get)).toEqual(['200', '401', '429']);
    expect(paths['/ingesta/catalogos']?.post?.security).toEqual([{ agente: [] }]);
    expect(paths['/ingesta/catalogos']?.post?.description).toContain('no intercala');
    for (const c of ['grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales']) {
      expect(codigos(paths[`/catalogos/${c}`]?.get)).toEqual(['200', '400', '401', '404']);
    }
    expect(codigos(paths['/catalogos/productos/{id}/metadata']?.put)).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(codigos(paths['/catalogos/sincronizacion/forzar']?.post)).toEqual([
      '202',
      '400',
      '401',
      '403',
      '404',
    ]);
    expect(JSON.stringify(paths['/catalogos/productos'])).toContain('PaginaProductosDto');
  });

  it('documenta el orquestador de menú y el precio del contrato de catálogos (F2-145)', async () => {
    const doc = await generarDocumento();
    const { paths } = doc;
    const codigos = (op?: { responses?: object }) => Object.keys(op?.responses ?? {}).sort();
    for (const r of ['/catalogos/menu', '/catalogos/sin-catalogo']) {
      expect(codigos(paths[r]?.get)).toEqual(['200', '400', '401', '404']);
    }
    const parametros = (paths['/catalogos/sin-catalogo']?.get?.parameters ?? []).map(
      (p) => (p as { name: string }).name,
    );
    expect(parametros.sort()).toEqual(['desde', 'empresaId', 'hasta', 'sucursalId']);
    const esquemas = doc.components?.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(esquemas.RegistroProductoDto.properties ?? {})).toContain('precio');
    expect(Object.keys(esquemas.FilaProductoDto.properties ?? {})).toContain('precio');
    expect(Object.keys(esquemas.ProductoMenuDto.properties ?? {})).toContain('discrepancia');
  });

  it('documenta el rendimiento por mesero y el tiempo de mesa de Análisis (F2-231)', async () => {
    const doc = await generarDocumento();
    const { paths } = doc;
    const op = paths['/catalogos/meseros/rendimiento']?.get;
    expect(Object.keys(op?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
    const parametros = (op?.parameters ?? []).map((p) => (p as { name: string }).name);
    expect(parametros.sort()).toEqual(['desde', 'empresaId', 'hasta', 'sucursalId']);
    expect(JSON.stringify(op?.responses?.['200'])).toContain('RendimientoMeserosDto');
    const esquemas = doc.components?.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(esquemas.FilaRendimientoMeseroDto.properties ?? {})).toEqual(
      expect.arrayContaining(['cruce', 'catalogo', 'descuentos', 'cancelados', 'posicion']),
    );
    const mesero = Object.keys(esquemas.VentaMeseroDto.properties ?? {});
    expect(mesero).toEqual(expect.arrayContaining(['minutosPromedio', 'cuentasConDuracion']));
    // Los segundos exactos son internos: no son parte del contrato.
    expect(mesero).not.toContain('segundos');
  });

  it('documenta Clientes, el filtro de Tickets por cliente y el cliente de la cuenta (F2-232)', async () => {
    const doc = await generarDocumento();
    const { paths } = doc;
    const nombres = (op?: { parameters?: unknown[] }) =>
      (op?.parameters ?? []).map((p) => (p as { name: string }).name).sort();
    const resumen = paths['/catalogos/clientes/resumen']?.get;
    expect(Object.keys(resumen?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
    expect(nombres(resumen)).toEqual(
      ['contacto', 'desde', 'empresaId', 'hasta', 'pagina', 'porPagina', 'q', 'sucursalId'].sort(),
    );
    const ficha = paths['/catalogos/clientes/{id}/ficha']?.get;
    expect(Object.keys(ficha?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
    expect(nombres(ficha)).toEqual(['desde', 'empresaId', 'hasta', 'id']);
    expect(nombres(paths['/ventas/tickets']?.get)).toContain('clienteId');
    const esquemas = doc.components?.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(esquemas.DatosChequeDto.properties ?? {})).toContain('clienteOrigenSrId');
    expect(Object.keys(esquemas.FilaResumenClienteDto.properties ?? {})).toEqual(
      expect.arrayContaining(['cruce', 'visitas', 'ticketPromedio', 'canceladas', 'telefono']),
    );
    expect(Object.keys(esquemas.FichaClienteDto.properties ?? {})).toEqual([
      'cliente',
      'periodo',
      'productos',
    ]);
  });

  it('documenta Áreas y canales: venta por área, el mapeo y el área de la cuenta (F2-233)', async () => {
    const doc = await generarDocumento();
    const { paths } = doc;
    const nombres = (op?: { parameters?: unknown[] }) =>
      (op?.parameters ?? []).map((p) => (p as { name: string }).name).sort();
    const porArea = paths['/ventas/por-area']?.get;
    expect(Object.keys(porArea?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
    const mapeo = paths['/catalogos/areas/mapeo']?.get;
    expect(nombres(mapeo)).toEqual(['empresaId', 'sucursalId']);
    const asignar = paths['/catalogos/areas/{id}/canal']?.put;
    expect(Object.keys(asignar?.responses ?? {}).sort()).toEqual(['200', '400', '401', '403', '404']);
    const esquemas = doc.components?.schemas as Record<
      string,
      { properties?: Record<string, { $ref?: string; allOf?: unknown[]; enum?: string[] }>; enum?: string[] }
    >;
    expect(Object.keys(esquemas.DatosChequeDto.properties ?? {})).toContain('areaOrigenSrId');
    expect(Object.keys(esquemas.VentaPorAreaDto.properties ?? {})).toEqual([
      'venta',
      'cuentas',
      'areas',
      'sinArea',
      'canales',
      'sinCanal',
      'catalogo',
    ]);
    expect(esquemas.CanalNegocio.enum).toEqual(['comedor', 'mostrador', 'domicilio', 'plataformas']);
    expect(Object.keys(esquemas.AsignarCanalAreaDto.properties ?? {})).toEqual(['empresaId', 'canal']);
  });

  it('F2-120: el contrato de catálogos incluye los cinco de inventario y el registro del insumo', async () => {
    const doc = await generarDocumento();
    const esquemas = doc.components?.schemas as Record<
      string,
      { properties?: Record<string, unknown>; enum?: string[] }
    >;
    expect(esquemas.CatalogoSr.enum).toEqual([
      'grupos',
      'productos',
      'meseros',
      'clientes',
      'areas',
      'canales',
      'unidades',
      'grupos_insumo',
      'insumos',
      'almacenes',
      'proveedores',
    ]);
    expect(Object.keys(esquemas.RegistroInsumoDto.properties ?? {})).toEqual([
      'origenSrId',
      'clave',
      'nombre',
      'activoPos',
      'grupoOrigenSrId',
      'unidadOrigenSrId',
    ]);
    expect(Object.keys(esquemas.FilaInsumoDto.properties ?? {})).toEqual(
      expect.arrayContaining(['grupoOrigenSrId', 'grupo', 'unidadOrigenSrId', 'unidad']),
    );
  });

  it('documenta todos los endpoints (auth, agentes, ingesta, lectura y administración)', async () => {
    const { paths } = await generarDocumento();
    expect(Object.keys(paths).sort()).toEqual(
      [
        '/agente/yo',
        '/agentes/estado',
        // F2-120: catálogos de inventario.
        '/catalogos/almacenes',
        '/catalogos/grupos-insumo',
        '/catalogos/insumos',
        '/catalogos/proveedores',
        '/catalogos/unidades',
        '/catalogos/areas',
        '/catalogos/areas/mapeo',
        '/catalogos/areas/{id}/canal',
        '/catalogos/canales',
        '/catalogos/clientes',
        '/catalogos/clientes/resumen',
        '/catalogos/clientes/{id}/ficha',
        '/catalogos/grupos',
        '/catalogos/menu',
        '/catalogos/meseros',
        '/catalogos/meseros/rendimiento',
        '/catalogos/productos',
        '/catalogos/productos/{id}',
        '/catalogos/productos/{id}/metadata',
        '/catalogos/sincronizacion',
        '/catalogos/sincronizacion/forzar',
        '/catalogos/sin-catalogo',
        '/alertas/abiertas',
        '/alertas/historial',
        '/alertas/reglas',
        '/alertas/reglas/{tipo}',
        '/auth/login',
        '/auth/logout',
        '/auth/me',
        '/auth/refresh',
        '/cuenta/password',
        '/cuenta/reportes',
        '/cuenta/reportes/vista-previa',
        '/reportes/baja',
        '/empresas',
        '/empresas/{id}',
        '/ingesta/catalogos',
        '/ingesta/catalogos/cierre',
        '/ingesta/catalogos/solicitud',
        '/ingesta/eventos',
        '/mesas/abiertas',
        '/sucursales',
        '/sucursales/{id}',
        '/sucursales/{id}/api-key',
        '/sistema',
        '/ventas/comparativo-sucursales',
        '/ventas/formas-pago',
        '/ventas/hora-dia',
        '/ventas/por-area',
        '/ventas/por-dia',
        '/ventas/por-hora',
        '/ventas/por-mesa',
        '/ventas/por-mesero',
        '/ventas/por-producto',
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
    // F1-093: público (lo identifica la cookie), 204 idempotente y con rate limit.
    expect(Object.keys(paths['/auth/logout']?.post?.responses ?? {}).sort()).toEqual([
      '204',
      '429',
    ]);
    expect(paths['/auth/logout']?.post?.security).toEqual([{ monitor_refresh: [] }]);
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
      '429', // F2-203: throttle `reset`, 10/min por IP.
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
    expect(heartbeat).toContain('latenciaQueryMs');
    expect(esquema).toContain('latenciaQueryMs');
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
      '/ventas/por-mesero',
      '/ventas/por-producto',
      '/ventas/hora-dia',
      '/ventas/por-mesa',
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
    // `alturaAl` (F2-220): el corte "a la misma altura" va en el filtro común de /ventas/*.
    const FILTRO = ['alturaAl', 'desde', 'empresaId', 'hasta', 'sucursalId'];
    expect(nombres('/ventas/resumen')).toEqual(FILTRO);
    expect(nombres('/ventas/por-dia')).toEqual(FILTRO);
    expect(nombres('/ventas/por-hora')).toEqual(FILTRO);
    expect(nombres('/ventas/formas-pago')).toEqual(FILTRO);
    expect(nombres('/ventas/comparativo-sucursales')).toEqual(FILTRO);
    // Análisis (F2-221): el mismo filtro común, sin parámetros propios.
    for (const ruta of [
      '/ventas/por-mesero',
      '/ventas/por-producto',
      '/ventas/hora-dia',
      '/ventas/por-mesa',
      // Áreas y canales (F2-233).
      '/ventas/por-area',
    ]) {
      expect(nombres(ruta)).toEqual(FILTRO);
    }
    expect(nombres('/ventas/top-productos')).toEqual([...FILTRO, 'limite', 'por'].sort());
    expect(nombres('/ventas/tickets')).toEqual(
      // `corte`: corte por recepción del export (F2-203).
      // Filtros y orden de F2-222.
      [
        ...FILTRO,
        'corte',
        'folio',
        'pagina',
        'porPagina',
        'mesero',
        'mesa',
        'forma',
        'importeMin',
        'importeMax',
        'canceladas',
        'producto',
        // Filtro por cliente de F2-232.
        'clienteId',
        'orden',
        'dir',
      ].sort(),
    );
    // Los enums y el aviso de acentos quedan en el contrato (el front construye contra él).
    const param = (n: string) =>
      paths['/ventas/tickets']?.get?.parameters?.find((p) => 'name' in p && p.name === n) as
        { description?: string; schema?: { enum?: string[]; pattern?: string } } | undefined;
    expect(param('canceladas')?.schema?.enum).toEqual(['incluir', 'excluir', 'solo']);
    expect(param('dir')?.schema?.enum).toEqual(['asc', 'desc']);
    expect(param('orden')?.schema?.enum).toEqual(
      expect.arrayContaining(['momento', 'folio', 'total', 'duracion']),
    );
    expect(param('importeMin')?.schema?.pattern).toBe('^-?\\d{1,10}(\\.\\d{1,2})?$');
    expect(param('producto')?.description).toMatch(/NO ignora acentos/);
    // Y su contrato dice lo que hace: instante con zona, exclusivo, sólo el último día, la
    // hora local de cada sucursal y cómo se resuelve un cambio de horario.
    const altura = paths['/ventas/resumen']?.get?.parameters?.find(
      (p) => 'name' in p && p.name === 'alturaAl',
    ) as { required?: boolean; description?: string; schema?: { format?: string } } | undefined;
    expect(altura?.required).toBe(false);
    expect(altura?.schema?.format).toBe('date-time');
    for (const frase of [
      'zona obligatoria',
      'ÚLTIMO día',
      'exclusivo',
      'CADA sucursal',
      'horario',
    ]) {
      expect(altura?.description).toContain(frase);
    }

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
