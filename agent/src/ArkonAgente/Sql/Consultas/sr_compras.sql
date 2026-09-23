-- Compras a proveedor (F2-241b) -> POST /ingesta/compras, una compra por idcompra con TODOS sus
-- renglones (Inventario/MapeoCompras.cs).
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe. @desde es un
-- parametro (hora local de SR): el cursor menos la ventana de relectura, que vive en el SQLite
-- del agente, nunca en esta base.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §10; la base local
-- no tiene compras):
--   dbo.compras: PK idcompra bigint (identity); folio varchar(15); fechaaplicacion datetime;
--     idproveedor varchar(15) (FK logica a proveedores); cancelado bit; descuento numeric(5,2).
--   dbo.comprasmovtos: SIN PK ni indice; idcompra, idinsumo varchar(15), costo money (SUPUESTO:
--     sin impuestos, hay importesinimpuestos aparte), descuento numeric(5,2), cantidad
--     numeric(14,4), idalmacen varchar(5) POR RENGLON.
-- LEFT JOIN: una compra sin renglones sale una vez con el renglon en NULL. Una compra con
-- fechaaplicacion NULL tambien se lee (el agente la cuenta y no la manda: no tiene fecha).
SELECT
    c.idcompra        AS compra,
    c.folio           AS folio,
    c.fechaaplicacion AS fecha,
    c.idproveedor     AS proveedor,
    c.cancelado       AS cancelado,
    c.descuento       AS descuento_compra,
    m.idinsumo        AS insumo,
    m.cantidad        AS cantidad,
    m.costo           AS costo,
    m.descuento       AS descuento_renglon,
    m.idalmacen       AS almacen
FROM dbo.compras AS c WITH (NOLOCK)
LEFT JOIN dbo.comprasmovtos AS m WITH (NOLOCK) ON m.idcompra = c.idcompra
WHERE c.fechaaplicacion >= @desde OR c.fechaaplicacion IS NULL;
