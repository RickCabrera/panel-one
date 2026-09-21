-- Sonda de salud de SoftRestaurant, una vez por ciclo (F1-025).
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Lee UNA fila
-- de dbo.parametros2, la misma tabla de la deteccion de version (VALIDADA en SR
-- 10.0.323, ver docs/esquema-sr.md §1): una sola fila, sin tocar las tablas de
-- operacion (cheques, tempcheques).
--
-- Es lo que el heartbeat reporta como "ultima lectura" y "latencia de query"
-- mientras el agente no lea ventas (F1-022/F1-023). OJO: una sonda que responde
-- dice que la base contesta, NO que las ventas esten llegando.
SELECT TOP (1)
    1 AS ok
FROM dbo.parametros2 AS p WITH (NOLOCK);
