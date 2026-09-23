-- Movimientos de inventario (F2-241b) -> POST /ingesta/movimientos, agrupados en polizas por el
-- agente (Inventario/MapeoMovimientos.cs).
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe. Los parametros
-- son hora local de SR y los calcula el agente con su cursor, que vive en su SQLite (nunca aqui):
--   @desde           = cursor menos la ventana de relectura (movimientos vivos).
--   @desdecanceladas = cursor menos una ventana MAS AMPLIA para movsinvcancelados (no se sabe si
--                      la fila cancelada conserva la fecha original: esquema-sr §10).
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §10; la base local
-- no tiene movimientos):
--   dbo.movsinv: HEAP sin PK ni indice alguno (el filtro por fecha es un table scan). fecha
--     datetime; foliocheque, movto, traspaso, invfisico numeric(8,0); idcompra numeric(10,0);
--     idconcepto varchar(5) (FK logica a conceptos); idinsumo varchar(15); costo money;
--     cantidad numeric(14,4) CON SIGNO (TRG_movsinv_insert la suma a acumuladoinsumos);
--     idalmacen varchar(5).
--   dbo.movsinvcancelados: la misma forma (salvo idpedido, que no se lee). SUPUESTO: lo cancelado
--     se MUEVE aqui (ningun modulo T-SQL de la base la toca: lo hace la aplicacion de SR).
--
-- La poliza se lee COMPLETA o no se lee: la ventana elige DOCUMENTOS (los que tienen al menos una
-- fila dentro), y de esos se traen TODAS sus filas, tambien las anteriores a la ventana. Si se
-- filtrara fila por fila, una poliza con filas a horas distintas llegaria a medias al panel y, como
-- el envio reemplaza, borraria partidas del kardex.
--
-- DECISION PROVISIONAL (nocturno): el documento es (clase + numero, almacen, concepto). La clase es
-- la primera columna distinta de NULL y de 0 en este orden: traspaso (T), idcompra (C), invfisico
-- (F), foliocheque (V), movto (M); sin ninguna, (S) = la fecha exacta. SUPUESTO no validado: nadie ha
-- visto una fila de movsinv con datos (F2-193). El agente arma la clave con estas mismas columnas.
WITH filas AS (
    SELECT
        0 AS cancelado, m.fecha, m.foliocheque, m.movto, m.idcompra, m.traspaso, m.invfisico,
        m.idconcepto, m.idinsumo, m.costo, m.cantidad, m.idalmacen
    FROM dbo.movsinv AS m WITH (NOLOCK)
    UNION ALL
    SELECT
        1, c.fecha, c.foliocheque, c.movto, c.idcompra, c.traspaso, c.invfisico,
        c.idconcepto, c.idinsumo, c.costo, c.cantidad, c.idalmacen
    FROM dbo.movsinvcancelados AS c WITH (NOLOCK)
),
documentos AS (
    SELECT
        f.*,
        CASE
            WHEN ISNULL(f.traspaso, 0) <> 0 THEN 'T' + CAST(CAST(f.traspaso AS bigint) AS varchar(20))
            WHEN ISNULL(f.idcompra, 0) <> 0 THEN 'C' + CAST(CAST(f.idcompra AS bigint) AS varchar(20))
            WHEN ISNULL(f.invfisico, 0) <> 0 THEN 'F' + CAST(CAST(f.invfisico AS bigint) AS varchar(20))
            WHEN ISNULL(f.foliocheque, 0) <> 0 THEN 'V' + CAST(CAST(f.foliocheque AS bigint) AS varchar(20))
            WHEN ISNULL(f.movto, 0) <> 0 THEN 'M' + CAST(CAST(f.movto AS bigint) AS varchar(20))
            ELSE 'S' + ISNULL(CONVERT(varchar(23), f.fecha, 121), '')
        END + '|' + ISNULL(RTRIM(f.idalmacen), '') + '|' + ISNULL(RTRIM(f.idconcepto), '') AS documento
    FROM filas AS f WITH (NOLOCK)
),
elegidos AS (
    SELECT DISTINCT e.documento
    FROM documentos AS e WITH (NOLOCK)
    WHERE (e.cancelado = 0 AND e.fecha >= @desde)
       OR (e.cancelado = 1 AND e.fecha >= @desdecanceladas)
)
SELECT
    d.cancelado    AS cancelado,
    d.fecha        AS fecha,
    d.foliocheque  AS foliocheque,
    d.movto        AS movto,
    d.idcompra     AS idcompra,
    d.traspaso     AS traspaso,
    d.invfisico    AS invfisico,
    d.idconcepto   AS concepto,
    d.idinsumo     AS insumo,
    d.costo        AS costo,
    d.cantidad     AS cantidad,
    d.idalmacen    AS almacen,
    d.documento    AS documento
FROM documentos AS d WITH (NOLOCK)
INNER JOIN elegidos AS k WITH (NOLOCK) ON k.documento = d.documento;
