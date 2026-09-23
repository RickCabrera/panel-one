-- Catalogo de clientes (F2-240) -> catalogo "clientes". DATOS PERSONALES.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
-- Solo lo que pide el contrato: nada de direccion, CURP, credito, fotografia ni notas.
--
-- VALIDADO 2026-09-23 contra SR 10 local, SOLO metadatos (docs/esquema-sr.md §8):
-- dbo.clientes, PK idcliente varchar(15); nombre varchar(max) NULL; telefono1
-- varchar(50); email varchar(250); rfc varchar(15). Varios son MAS LARGOS que el
-- contrato (nombre 200, telefono 40, correo 200, rfc 13): el API rechaza ese
-- registro y el agente lo registra; no se recorta (§13). status bit NOT NULL existe
-- pero sin ningun cliente en la base no hay evidencia de su sentido: no se lee.
SELECT
    c.idcliente AS id,
    c.nombre    AS nombre,
    c.telefono1 AS telefono,
    c.email     AS correo,
    c.rfc       AS rfc
FROM dbo.clientes AS c WITH (NOLOCK)
ORDER BY c.idcliente;
