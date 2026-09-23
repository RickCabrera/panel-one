-- Recetas (explosion de insumos por producto, F2-241b) -> POST /ingesta/recetas, una receta por
-- producto con TODOS sus renglones (Inventario/MapeoRecetas.cs).
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe. Se lee la
-- tabla completa (no hay fecha): el agente sabe que cambio comparando contra su SQLite.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §10; la base local
-- no tiene recetas):
--   dbo.costos: SIN PK ni indice; idproducto varchar(15) (FK a productos), idinsumo varchar(15)
--     (FK a insumos), cantidad numeric(12,4), idempresa varchar(15).
--   SUPUESTO: es la receta vigente, por UNA unidad vendida y en la unidad del insumo.
SELECT
    r.idproducto AS producto,
    r.idinsumo   AS insumo,
    r.cantidad   AS cantidad,
    r.idempresa  AS empresa
FROM dbo.costos AS r WITH (NOLOCK);
