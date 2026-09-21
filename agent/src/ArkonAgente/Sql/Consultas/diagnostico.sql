-- Diagnostico de conexion de `agente test` y del arranque del servicio (F1-020).
--
-- SOLO LECTURA y sin tocar ninguna tabla de SoftRestaurant: son funciones de
-- sistema de SQL Server, por eso no lleva WITH (NOLOCK) (no hay tabla que
-- bloquear). El timeout corto lo pone el codigo (CommandTimeout = 5 s).
--
-- Las columnas de permisos existen para detectar un usuario que PUEDE escribir:
-- el agente nunca escribe en la base del POS, pero la regla la hace cumplir el
-- permiso, no la buena voluntad del codigo. Un 1 en cualquiera de ellas hace que
-- `agente test` marque FALLA. HAS_PERMS_BY_NAME / IS_ROLEMEMBER pueden devolver
-- NULL (rol inexistente, sin visibilidad); el codigo trata NULL como "no".
--
-- LIMITE CONOCIDO: se revisan servidor, base y esquema dbo. Un GRANT sobre una
-- tabla concreta (permiso por objeto) NO se detecta aqui. Ver docs/esquema-sr.md §11.
SELECT
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version_producto,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(128))        AS edicion,
    DB_NAME()                                               AS base_datos,
    SUSER_SNAME()                                           AS login_sql,
    IS_SRVROLEMEMBER('sysadmin')                            AS es_sysadmin,
    IS_ROLEMEMBER('db_owner')                               AS es_db_owner,
    IS_ROLEMEMBER('db_datawriter')                          AS es_db_datawriter,
    IS_ROLEMEMBER('db_ddladmin')                            AS es_db_ddladmin,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT')       AS puede_insert,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE')       AS puede_update,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE')       AS puede_delete,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER')        AS puede_alter,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS puede_create_table,
    HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'INSERT')            AS dbo_puede_insert,
    HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'UPDATE')            AS dbo_puede_update,
    HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'DELETE')            AS dbo_puede_delete,
    HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'ALTER')             AS dbo_puede_alter;
