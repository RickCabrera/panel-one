-- Catalogo de areas del restaurante (F2-240) -> catalogo "areas".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §8):
-- dbo.areasrestaurant, PK idarearestaurant varchar(5); descripcion varchar(30) NULL;
-- Estatus bit NOT NULL. OJO: dbo.areas (idarea varchar(4)) es OTRA cosa (area de
-- produccion/impresion de productosdetalle y estacionesareas), no el area de la cuenta.
-- SUPUESTO: cheques.idarearestaurant apunta aqui (por nombre y tipo; no hay FK), y
-- Estatus = 1 es area vigente (en esta base las 3 tienen 1).
SELECT
    a.idarearestaurant AS id,
    a.descripcion      AS nombre,
    a.Estatus          AS estatus
FROM dbo.areasrestaurant AS a WITH (NOLOCK)
ORDER BY a.idarearestaurant;
