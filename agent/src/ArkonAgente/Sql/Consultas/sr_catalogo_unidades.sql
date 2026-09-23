-- Catalogo de unidades de inventario (F2-241) -> catalogo "unidades".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §9):
-- SR 10 NO tiene tabla de unidades. La unidad es texto libre en dbo.insumos.unidad
-- varchar(10) NULL, collation Modern_Spanish_CI_AS. DECISION PROVISIONAL (nocturno):
-- el catalogo son las unidades DISTINTAS que usan los insumos. El DISTINCT va con
-- collation BINARIA para que SQL Server no elija al azar entre "kg" y "KG": las junta
-- el agente con la misma clave que manda en el insumo (MapeoCatalogos.ClaveUnidad).
SELECT DISTINCT
    i.unidad COLLATE Latin1_General_BIN2 AS id
FROM dbo.insumos AS i WITH (NOLOCK)
WHERE i.unidad IS NOT NULL
ORDER BY id;
