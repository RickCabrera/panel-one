-- Turnos (cortes de caja) de SoftRestaurant (MVP de cortes) -> evento 'turno' de
-- POST /ingesta/eventos. Lo arma el agente en Ventas/MapeoTurnos.cs.
--
-- SOLO LECTURA, WITH (NOLOCK) y timeout corto (lo pone el codigo). Nunca escribe. Un resultado:
-- los turnos ABIERTOS (cierre NULL) y los que se abrieron o cerraron desde @desde.
--
-- Parametro (hora LOCAL de la PC, como guarda SR; lo calcula el agente, nunca se guarda aqui):
--   @desde = ventana de relectura (hoy menos 7 dias): un turno cerrado antes ya no cambia.
--
-- VALIDADO F1-090 (docs/esquema-sr.md §2, "Turnos"), contra SR 10 local con monitor_lector:
--   * Una fila por turno: idturno (1, 2...), fondo, apertura y cierre (hora local, sin
--     milisegundos; cierre NULL = turno abierto) e idestacion.
--   * efectivo / tarjeta / vales / credito son lo que el cajero DECLARA al cerrar, no lo vendido
--     (se declararon en 0.00 con 3065.50 vendidos). Lo vendido sale de los cheques por idturno.
--   * Un turno puede durar dias (el visto duro del 19 al 22-oct): por eso entra todo turno abierto,
--     aunque se haya abierto antes de @desde.
-- SUPUESTO (no visto): los tipos exactos de las columnas (se leen con conversion), que idturno no se
--   repite nunca dentro de una base (solo se vieron el 1 y el 2) y que varias estaciones pueden
--   tener turnos abiertos a la vez (el lector no lo impide).
-- SUPUESTO de rendimiento: la tabla tiene una fila por turno (unas cuantas al dia); sin indice
--   sobre cierre la lectura es un escaneo de una tabla chica.
SELECT
    CAST(tu.idturno AS bigint) AS idturno,
    tu.apertura                AS apertura,
    tu.cierre                  AS cierre,
    tu.idestacion              AS idestacion,
    tu.fondo                   AS fondo,
    tu.efectivo                AS efectivo,
    tu.tarjeta                 AS tarjeta,
    tu.vales                   AS vales,
    tu.credito                 AS credito
FROM dbo.turnos AS tu WITH (NOLOCK)
WHERE tu.cierre IS NULL OR tu.cierre >= @desde OR tu.apertura >= @desde
ORDER BY tu.idturno;
