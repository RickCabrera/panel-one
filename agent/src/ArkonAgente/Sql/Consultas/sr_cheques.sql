-- Cuentas cerradas (cobradas o canceladas) de SoftRestaurant (F1-022) -> evento 'cheque' de
-- POST /ingesta/eventos. Lo arma el agente en Ventas/MapeoCheques.cs.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe. Cuatro
-- resultados, en este orden: (1) el MAX(folio) de cheques, (2) las cuentas, (3) sus partidas,
-- (4) sus pagos. Las tres ultimas usan el MISMO filtro.
--
-- Parametros (hora LOCAL de la PC, como guarda SR; los calcula el agente con su cursor, que vive
-- en su SQLite, nunca aqui):
--   @ultimofolio = el mayor cheques.folio ya leido (-1 la primera vez).
--   @piso        = no se leen por cursor cuentas cerradas antes de esta fecha (primera lectura).
--   @desde       = ventana de relectura: cuentas de cheques ABIERTAS desde esta fecha se releen
--                  siempre (cancelaciones despues del corte). Usa el indice de cheques.fecha.
--
-- VALIDADO 2026-10-22 contra SR 10 local con monitor_lector (salvo lo marcado SUPUESTO abajo) (docs/esquema-sr.md §2-§4, F1-090):
--   * Una cuenta cobrada se queda en tempcheques (pagado = 1) hasta el corte del turno, que la
--     copia a cheques con OTRO folio interno. Por eso se leen las dos tablas.
--   * tempcheques con pagado = 0 y cancelado = 0 es una cuenta ABIERTA (F1-023): no se lee aqui,
--     aunque ya este impresa (una impresa sin cobrar ya trae cierre).
--   * Partidas por foliodet = folio y pagos por folio, de SU tabla (temp* o definitivas).
--   * La tabla cancela NO se une con cheques: sus filas de cuentas borradas traen foliocheque = 0,
--     que choca con el folio 0 real de cheques.
--   * meseros.idmesero no es unico (sin indice): se toma UN nombre con TOP (1).
-- SUPUESTO (NO visto en F1-090): cancelado = 1, fechacancelado y reabiertas. Cancelar o reabrir una
--   cuenta YA COBRADA no se pudo provocar desde COMEDOR; se lee cancelado tal cual y la relectura de
--   @desde sobre cheques.fecha supone que una cancelacion posterior al corte cae en esa ventana (es
--   decision abierta: puede hacer falta releer por fechacancelado). Validarlo con una cuenta
--   cancelada despues de cobrar, antes y despues del corte.
-- SUPUESTO de rendimiento: los 56 ms se midieron con 20 cuentas; con anos de cheques el OR con
--   ISNULL no usa indice. Revisar el plan con volumen real (F1-091).
-- DECISION PROVISIONAL (nocturno): una cuenta cerrada hace mas de @piso y movida a cheques despues
-- de una caida larga del agente no se lee por cursor; la relectura cubre las de las ultimas horas.
SELECT MAX(c.folio) AS max_folio
FROM dbo.cheques AS c WITH (NOLOCK);

SELECT
    'T'                                  AS origen,
    t.folio                              AS folio,
    CAST(t.numcheque AS bigint)          AS numcheque,
    t.seriefolio                         AS seriefolio,
    t.fecha                              AS fecha,
    t.cierre                             AS cierre,
    t.mesa                               AS mesa,
    CAST(t.nopersonas AS int)            AS nopersonas,
    (SELECT TOP (1) m.nombre FROM dbo.meseros AS m WITH (NOLOCK)
     WHERE m.idmesero = t.idmesero ORDER BY m.idmeserointerno) AS mesero,
    t.idarearestaurant                   AS area,
    t.idcliente                          AS cliente,
    t.subtotal                           AS subtotal,
    t.descuentoimporte                   AS descuentoimporte,
    t.totalimpuesto1                     AS impuestos,
    t.totaldescuentos                    AS totaldescuentos,
    t.totalcortesias                     AS totalcortesias,
    t.propina                            AS propina,
    t.total                              AS total,
    CAST(ISNULL(t.cancelado, 0) AS bit)  AS cancelado
FROM dbo.tempcheques AS t WITH (NOLOCK)
WHERE t.pagado = 1 OR t.cancelado = 1
UNION ALL
SELECT
    'C', c.folio, CAST(c.numcheque AS bigint), c.seriefolio, c.fecha, c.cierre, c.mesa,
    CAST(c.nopersonas AS int),
    (SELECT TOP (1) m.nombre FROM dbo.meseros AS m WITH (NOLOCK)
     WHERE m.idmesero = c.idmesero ORDER BY m.idmeserointerno),
    c.idarearestaurant, c.idcliente, c.subtotal, c.descuentoimporte, c.totalimpuesto1,
    c.totaldescuentos, c.totalcortesias, c.propina, c.total, CAST(ISNULL(c.cancelado, 0) AS bit)
FROM dbo.cheques AS c WITH (NOLOCK)
WHERE (c.folio > @ultimofolio AND ISNULL(c.cierre, c.fecha) >= @piso) OR c.fecha >= @desde;

SELECT
    'T'                  AS origen,
    d.foliodet           AS folio,
    d.movimiento         AS movimiento,
    d.cantidad           AS cantidad,
    d.idproducto         AS idproducto,
    p.descripcion        AS producto,
    g.descripcion        AS categoria,
    d.precio             AS precio,
    d.descuento          AS descuento,
    CAST(ISNULL(d.modificador, 0) AS bit) AS modificador
FROM dbo.tempcheqdet AS d WITH (NOLOCK)
INNER JOIN dbo.tempcheques AS t WITH (NOLOCK) ON t.folio = d.foliodet
LEFT JOIN dbo.productos AS p WITH (NOLOCK) ON p.idproducto = d.idproducto
LEFT JOIN dbo.grupos AS g WITH (NOLOCK) ON g.idgrupo = p.idgrupo
WHERE t.pagado = 1 OR t.cancelado = 1
UNION ALL
SELECT
    'C', d.foliodet, d.movimiento, d.cantidad, d.idproducto, p.descripcion, g.descripcion, d.precio,
    d.descuento, CAST(ISNULL(d.modificador, 0) AS bit)
FROM dbo.cheqdet AS d WITH (NOLOCK)
INNER JOIN dbo.cheques AS c WITH (NOLOCK) ON c.folio = d.foliodet
LEFT JOIN dbo.productos AS p WITH (NOLOCK) ON p.idproducto = d.idproducto
LEFT JOIN dbo.grupos AS g WITH (NOLOCK) ON g.idgrupo = p.idgrupo
WHERE (c.folio > @ultimofolio AND ISNULL(c.cierre, c.fecha) >= @piso) OR c.fecha >= @desde
ORDER BY origen, folio, movimiento;

SELECT
    'T'                  AS origen,
    x.folio              AS folio,
    x.idformadepago      AS idformadepago,
    f.descripcion        AS forma,
    x.importe            AS importe
FROM dbo.tempchequespagos AS x WITH (NOLOCK)
INNER JOIN dbo.tempcheques AS t WITH (NOLOCK) ON t.folio = x.folio
LEFT JOIN dbo.formasdepago AS f WITH (NOLOCK) ON f.idformadepago = x.idformadepago
WHERE t.pagado = 1 OR t.cancelado = 1
UNION ALL
SELECT 'C', x.folio, x.idformadepago, f.descripcion, x.importe
FROM dbo.chequespagos AS x WITH (NOLOCK)
INNER JOIN dbo.cheques AS c WITH (NOLOCK) ON c.folio = x.folio
LEFT JOIN dbo.formasdepago AS f WITH (NOLOCK) ON f.idformadepago = x.idformadepago
WHERE (c.folio > @ultimofolio AND ISNULL(c.cierre, c.fecha) >= @piso) OR c.fecha >= @desde
ORDER BY origen, folio, idformadepago;
