-- Catalogo de tipos de servicio como "canales" (F2-240) -> catalogo "canales".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §8):
-- dbo.tiposervicio, SIN PK; Idtiposervicio nchar(20) NULL, Desc_tiposervicio
-- varchar(50) NULL. En esa base esta VACIA, aunque areasrestaurant.idtiposervicio
-- (numeric) vale 1, 2 y 3: puede que no sea el catalogo al que apuntan las areas
-- (decision abierta en §8). Vacia -> el agente cierra "canales" con total = 0.
SELECT
    t.Idtiposervicio    AS id,
    t.Desc_tiposervicio AS nombre
FROM dbo.tiposervicio AS t WITH (NOLOCK)
ORDER BY t.Idtiposervicio;
