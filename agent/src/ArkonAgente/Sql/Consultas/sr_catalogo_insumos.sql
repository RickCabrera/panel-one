-- Catalogo de insumos (F2-241) -> catalogo "insumos".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §9):
--   dbo.insumos: PK idinsumo varchar(15), descripcion varchar(60) NULL, idgruposi
--     varchar(5) NULL (grupo), unidad varchar(10) NULL (texto libre: no hay tabla de
--     unidades), elaborado bit NULL. Sin columna de estado.
--   dbo.insumosdetalle: SIN PK; idinsumo (FK a insumos), idempresa, estatus int NULL,
--     costos (NO se leen aqui: el costo viaja con las existencias, y el contrato del
--     catalogo rechaza un campo de mas).
-- Una fila por (insumo, fila de detalle), como productos: el agente las consolida
-- (MapeoCatalogos). SUPUESTO: estatus = 1 vigente, 0 baja.
SELECT
    i.idinsumo    AS id,
    i.descripcion AS nombre,
    i.idgruposi   AS grupo,
    i.unidad      AS unidad,
    d.estatus     AS estatus
FROM dbo.insumos AS i WITH (NOLOCK)
LEFT JOIN dbo.insumosdetalle AS d WITH (NOLOCK) ON d.idinsumo = i.idinsumo
ORDER BY i.idinsumo, d.idempresa;
