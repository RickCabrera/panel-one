-- Catalogo de formas de pago (PAG-01) -> catalogo "formas_pago".
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe.
--
-- VALIDADO 2026-10-19 -> 22 contra SR 10 local (F1-090, docs/esquema-sr.md §4):
-- dbo.formasdepago, idformadepago varchar(5) (la clave que guardan los pagos),
-- descripcion (el texto que la ingesta de cheques guarda como forma_raw) y tipo, que
-- agrupa: 1 efectivo, 2 tarjeta, 3 vales, 4 otros (las columnas efectivo / tarjeta /
-- vales / otros de la cuenta). El mapeo a nuestro ENUM lo hace el API, no el agente.
--
-- Si la instalacion no tiene la columna tipo, SQL Server rechaza esta consulta al
-- compilarla (error 207) y el agente usa sr_catalogo_formas_pago_sin_tipo: manda las
-- formas sin tipo y lo registra en su log.
-- idformapago_SAT no se lee: el mapeo no la usa (la c_FormaPago del CFDI sale de
-- nuestro ENUM, §2) y no se ha visto si todas las versiones la tienen.
SELECT
    f.idformadepago AS id,
    f.descripcion   AS nombre,
    f.tipo          AS tipo
FROM dbo.formasdepago AS f WITH (NOLOCK)
ORDER BY f.idformadepago;
