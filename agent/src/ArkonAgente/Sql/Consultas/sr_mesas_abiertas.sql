-- Cuentas ABIERTAS del turno en curso (F1-023) -> snapshot de POST /ingesta/eventos.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-10-22 contra SR 10 local (F1-090, docs/esquema-sr.md §5): una cuenta abierta
-- es una fila de dbo.tempcheques con pagado = 0 y cancelado = 0. Las COBRADAS del turno se
-- quedan en tempcheques (pagado = 1) hasta el corte y NO son mesas abiertas. Las partidas
-- estan en dbo.tempcheqdet, colgadas por foliodet = tempcheques.folio, en orden de movimiento.
--
-- Dos resultados: (1) las cuentas, (2) sus partidas. Son dos lecturas NOLOCK seguidas: una
-- partida cuya cuenta ya no esta en (1) (la cobraron entre una y otra) la ignora el agente.
-- meseros.idmesero NO tiene indice unico: un LEFT JOIN podria repetir la cuenta; el agente
-- se queda con la primera y lo avisa.

SELECT
    c.folio        AS folio,
    c.numcheque    AS numcheque,
    c.mesa         AS mesa,
    m.nombre       AS mesero,
    c.fecha        AS abierto,
    c.nopersonas   AS comensales,
    c.impreso      AS impreso,
    c.total        AS total
FROM dbo.tempcheques AS c WITH (NOLOCK)
LEFT JOIN dbo.meseros AS m WITH (NOLOCK) ON m.idmesero = c.idmesero
WHERE ISNULL(c.pagado, 0) = 0
  AND ISNULL(c.cancelado, 0) = 0
ORDER BY c.folio;

SELECT
    d.foliodet        AS folio,
    d.movimiento      AS movimiento,
    d.idproducto      AS clave,
    p.descripcion     AS producto,
    g.descripcion     AS categoria,
    d.cantidad        AS cantidad,
    d.precio          AS precio,
    d.descuento       AS descuento,
    d.modificador     AS modificador,
    d.comanda_impresa AS comanda_impresa
FROM dbo.tempcheqdet AS d WITH (NOLOCK)
INNER JOIN dbo.tempcheques AS c WITH (NOLOCK) ON c.folio = d.foliodet
LEFT JOIN dbo.productos AS p WITH (NOLOCK) ON p.idproducto = d.idproducto
LEFT JOIN dbo.grupos AS g WITH (NOLOCK) ON g.idgrupo = p.idgrupo
WHERE ISNULL(c.pagado, 0) = 0
  AND ISNULL(c.cancelado, 0) = 0
ORDER BY d.foliodet, d.movimiento;
