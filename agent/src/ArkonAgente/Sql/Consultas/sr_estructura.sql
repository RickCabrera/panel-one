-- Deteccion de SoftRestaurant, paso 1 (F1-021): que tablas de SR hay en la base.
--
-- SOLO LECTURA y sin tocar ninguna tabla del POS: lee vistas de catalogo
-- (sys.tables, sys.schemas, sys.columns), con WITH (NOLOCK) y el timeout corto que
-- pone el codigo (ConexionSoftRestaurant.TimeoutComandoSegundos).
--
-- Devuelve una fila por cada tabla candidata que exista en el esquema dbo:
--   * parametros2 con su columna versiondb: de ahi sale la version (paso 2,
--     sr_version.sql). Solo se consulta si esta fila dice que existe; si no, esa
--     query daria el error 208 (objeto inexistente).
--   * las tablas nucleo que leeran F1-022 / F1-023.
-- VALIDADO en SR 10.0.323 (versiondb 10.021800, SQL Server 2014 Express): todas en
-- dbo. SUPUESTO para cualquier otra version. Ver docs/esquema-sr.md §1.
--
-- SQL Server 2014 (el que instala SR 10) no tiene STRING_AGG: por eso una fila por
-- tabla y no una lista.
SELECT
    t.name AS tabla,
    CAST(CASE WHEN EXISTS (
        SELECT 1
        FROM sys.columns AS c WITH (NOLOCK)
        WHERE c.object_id = t.object_id AND c.name = N'versiondb'
    ) THEN 1 ELSE 0 END AS bit) AS tiene_versiondb
FROM sys.tables AS t WITH (NOLOCK)
JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = t.schema_id
WHERE s.name = N'dbo'
  AND t.name IN (N'parametros2', N'cheques', N'cheqdet', N'chequespagos', N'tempcheques', N'tempcheqdet');
