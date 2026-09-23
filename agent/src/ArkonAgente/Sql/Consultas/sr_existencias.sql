-- Existencias por almacen con su costo promedio (F2-241) -> POST /ingesta/existencias,
-- una foto por almacen.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos y definicion de triggers
-- (docs/esquema-sr.md §10; la base local no tiene movimientos):
--   dbo.acumuladoinsumos: PK id int; idinsumo varchar(15) (FK a insumos), idalmacen
--     varchar(5) (FK a almacen), existencia numeric(14,4). SIN indice unico sobre
--     (idinsumo, idalmacen). La mantienen los triggers TRG_movsinv_insert/update/delete:
--     existencia += cantidad de cada movsinv (sin mirar el concepto), asi que es la
--     existencia corrida del POS. Solo hay fila para (insumo, almacen) que alguna vez se
--     movio; una vez creada se queda aunque llegue a 0.
--   dbo.insumosdetalle: SIN PK; costopromedio money por (insumo, empresa), NO por almacen.
--     SUPUESTO: SR valua con costopromedio (no con costo ni costoestandar); lo valida F2-193.
--   dbo.almacen: idempresa = la empresa cuyo costo aplica a ese almacen.
-- FULL JOIN: una fila por almacen sin existencias (fila = NULL: su foto va vacia, porque
-- la lectura SI salio bien) y una fila de acumuladoinsumos cuyo almacen no este en
-- dbo.almacen no se pierde (huerfano = 1; el agente la manda y lo avisa).
-- Una fila por (fila de acumuladoinsumos, fila de detalle de su empresa): el agente
-- junta las de una misma fila (MapeoExistencias).
SELECT
    COALESCE(al.idalmacen, a.idalmacen)          AS almacen,
    CASE WHEN al.idalmacen IS NULL THEN 1 ELSE 0 END AS huerfano,
    a.id                                         AS fila,
    COALESCE(i.idinsumo, a.idinsumo)             AS insumo,
    a.existencia                                 AS existencia,
    d.costopromedio                              AS costo
FROM dbo.almacen AS al WITH (NOLOCK)
FULL OUTER JOIN dbo.acumuladoinsumos AS a WITH (NOLOCK) ON a.idalmacen = al.idalmacen
LEFT JOIN dbo.insumos AS i WITH (NOLOCK) ON i.idinsumo = a.idinsumo
LEFT JOIN dbo.insumosdetalle AS d WITH (NOLOCK) ON d.idinsumo = a.idinsumo AND d.idempresa = al.idempresa
ORDER BY almacen, fila;
