-- Catalogo de almacenes (F2-241) -> catalogo "almacenes".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §9):
-- dbo.almacen, PK idalmacen varchar(5); nombre varchar(30) NULL; idempresa
-- varchar(15) NULL (FK a empresas); tipo numeric(1) NULL (en esta base: 2 = ALMACEN
-- GENERAL, 1 = BARRA y COCINA; significado sin validar, no viaja). SUPUESTO: no
-- tiene columna de estado; activoPos viaja nulo.
SELECT
    a.idalmacen AS id,
    a.nombre    AS nombre
FROM dbo.almacen AS a WITH (NOLOCK)
ORDER BY a.idalmacen;
