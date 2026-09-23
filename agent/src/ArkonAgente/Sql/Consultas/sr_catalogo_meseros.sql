-- Catalogo de meseros (F2-240) -> catalogo "meseros".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
-- La tabla guarda la CONTRASENA del mesero y su fotografia: NUNCA se seleccionan
-- (un test lo vigila). Solo las columnas de abajo.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §7):
-- dbo.meseros, PK idmeserointerno bigint; idmesero varchar(4) NOT NULL SIN indice
-- unico (la clave que ve el usuario); nombre varchar(60) NULL; visible numeric(1) NULL.
-- SUPUESTO: visible = 1 es mesero vigente (en esta base los 2 meseros tienen 1).
SELECT
    CAST(m.idmeserointerno AS varchar(20)) AS id,
    m.idmesero                             AS clave,
    m.nombre                               AS nombre,
    m.visible                              AS visible
FROM dbo.meseros AS m WITH (NOLOCK)
ORDER BY m.idmeserointerno;
