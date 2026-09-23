-- Catalogo de grupos de productos (F2-240) -> POST /ingesta/catalogos, catalogo "grupos".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local (versiondb 10.021800), SOLO metadatos:
-- dbo.grupos, PK idgrupo varchar(5); descripcion varchar(30) NULL. FK real
-- productos.idgrupo -> grupos.idgrupo (sys.foreign_keys).
-- SUPUESTO: no tiene columna de estado; activoPos viaja nulo ("el POS no lo reporta").
-- Los alias van en minusculas: el mapeo los busca por nombre sin distinguir
-- mayusculas (docs/esquema-sr.md §12).
SELECT
    g.idgrupo     AS id,
    g.descripcion AS nombre
FROM dbo.grupos AS g WITH (NOLOCK)
ORDER BY g.idgrupo;
