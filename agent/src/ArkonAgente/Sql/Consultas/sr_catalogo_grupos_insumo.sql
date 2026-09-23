-- Catalogo de grupos de insumos (F2-241) -> catalogo "grupos_insumo".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §9):
-- dbo.gruposi, PK idgruposi varchar(5); descripcion varchar(30) NULL;
-- idgruposiclasificacion varchar(5) (FK a gruposiclasificacion: ALIMENTOS, BEBIDAS,
-- OTROS; el contrato no la lleva). SUPUESTO: no tiene columna de estado; activoPos
-- viaja nulo ("el POS no lo reporta").
SELECT
    g.idgruposi   AS id,
    g.descripcion AS nombre
FROM dbo.gruposi AS g WITH (NOLOCK)
ORDER BY g.idgruposi;
