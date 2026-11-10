-- Catalogo de formas de pago SIN la columna tipo (PAG-01) -> catalogo "formas_pago".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- Respaldo de sr_catalogo_formas_pago para una instalacion cuya dbo.formasdepago no
-- tiene la columna tipo (SQL Server rechaza la otra consulta con el error 207). Mismas
-- columnas, con tipo siempre NULL: el panel no clasifica esas formas (siguen contando
-- como "otro" y saliendo en "sin catalogo") y el agente lo registra en su log.
SELECT
    f.idformadepago   AS id,
    f.descripcion     AS nombre,
    CAST(NULL AS int) AS tipo
FROM dbo.formasdepago AS f WITH (NOLOCK)
ORDER BY f.idformadepago;
