-- Catalogo de proveedores (F2-241) -> catalogo "proveedores".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
-- El contrato solo lleva id, clave, nombre y estado: RFC, direccion, telefono,
-- correo y datos bancarios (nombrebanco, nocuenta, cuentaclave) NUNCA se seleccionan
-- (un test lo vigila).
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §9):
-- dbo.proveedores, PK idproveedor varchar(15); nombre varchar(50) NULL; estatus
-- numeric(1) NULL. SUPUESTO: estatus = 1 vigente, 0 baja (la base local no tiene
-- proveedores: sin evidencia de valores).
SELECT
    p.idproveedor AS id,
    p.nombre      AS nombre,
    p.estatus     AS estatus
FROM dbo.proveedores AS p WITH (NOLOCK)
ORDER BY p.idproveedor;
