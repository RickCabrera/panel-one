-- Catalogo de productos con su grupo, precio y estado (F2-240) -> catalogo "productos".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §6):
--   dbo.productos: PK idproducto varchar(15), descripcion varchar(60) NULL,
--     idgrupo varchar(5) NULL (FK a grupos).
--   dbo.productosdetalle: SIN PK; idproducto (FK a productos), idempresa (FK a
--     empresas), precio money NULL, bloqueado bit NULL.
-- Una fila por (producto, fila de detalle): un producto sin detalle sale una vez con
-- precio y bloqueado NULL; uno con varias empresas sale varias veces y el agente las
-- consolida (MapeoCatalogos). SUPUESTO: bloqueado = 1 es producto suspendido.
SELECT
    p.idproducto  AS id,
    p.descripcion AS nombre,
    p.idgrupo     AS grupo,
    d.precio      AS precio,
    d.bloqueado   AS bloqueado
FROM dbo.productos AS p WITH (NOLOCK)
LEFT JOIN dbo.productosdetalle AS d WITH (NOLOCK) ON d.idproducto = p.idproducto
ORDER BY p.idproducto, d.idempresa;
