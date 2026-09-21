-- Deteccion de SoftRestaurant, paso 2 (F1-021): la version de la base.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Se corre solo
-- si sr_estructura.sql confirmo que dbo.parametros2 tiene la columna versiondb.
--
-- VALIDADO en SR 10.0.323: parametros2 tiene UNA fila y versiondb es
-- numeric(15,6) NOT NULL con 10.021800. Se castea a texto para no depender del
-- tipo (SUPUESTO: en otra version puede ser varchar). TOP (2) para notar si hay
-- mas de una fila: el codigo lo trata como version ambigua, no elige una al azar.
--
-- OJO: configuracion.versiondb y parametros.versiondb tambien existen, pero en esa
-- instalacion valen NULL y '0'. No son la version. Ver docs/esquema-sr.md §1.
SELECT TOP (2)
    CAST(p.versiondb AS nvarchar(40)) AS version_db
FROM dbo.parametros2 AS p WITH (NOLOCK);
