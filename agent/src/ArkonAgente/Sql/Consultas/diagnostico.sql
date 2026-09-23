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
-- Permisos POR OBJETO (F2-240): INSERT/UPDATE/DELETE/ALTER sobre cada tabla que
-- el agente lee (la lista de VALUES de abajo; un test exige que toda tabla de una
-- consulta sr_*.sql este en ella). HAS_PERMS_BY_NAME de un objeto que no existe da
-- NULL y no cuenta. obj_escritura_total = cuantos (tabla, permiso) dan 1;
-- obj_escritura_ejemplo = el primero, para el mensaje.
--
-- LIMITE CONOCIDO: un GRANT sobre una tabla que el agente NO lee no se detecta
-- aqui (no le afecta al agente, pero el usuario ya no seria de solo lectura).
-- Ver docs/esquema-sr.md §11.
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
    HAS_PERMS_BY_NAME('dbo', 'SCHEMA', 'ALTER')             AS dbo_puede_alter,
    (SELECT COUNT(*)
     FROM (VALUES (N'dbo.parametros2'), (N'dbo.cheques'), (N'dbo.cheqdet'), (N'dbo.chequespagos'),
                 (N'dbo.tempcheques'), (N'dbo.tempcheqdet'), (N'dbo.grupos'), (N'dbo.productos'),
                 (N'dbo.productosdetalle'), (N'dbo.meseros'), (N'dbo.areasrestaurant'),
                 (N'dbo.tiposervicio'), (N'dbo.clientes'), (N'dbo.insumos'), (N'dbo.insumosdetalle'),
                 (N'dbo.gruposi'), (N'dbo.almacen'), (N'dbo.proveedores'), (N'dbo.acumuladoinsumos')) AS o(nombre)
     CROSS JOIN (VALUES (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'ALTER')) AS p(permiso)
     WHERE HAS_PERMS_BY_NAME(o.nombre, 'OBJECT', p.permiso) = 1) AS obj_escritura_total,
    (SELECT TOP (1) o.nombre + N': ' + p.permiso
     FROM (VALUES (N'dbo.parametros2'), (N'dbo.cheques'), (N'dbo.cheqdet'), (N'dbo.chequespagos'),
                 (N'dbo.tempcheques'), (N'dbo.tempcheqdet'), (N'dbo.grupos'), (N'dbo.productos'),
                 (N'dbo.productosdetalle'), (N'dbo.meseros'), (N'dbo.areasrestaurant'),
                 (N'dbo.tiposervicio'), (N'dbo.clientes'), (N'dbo.insumos'), (N'dbo.insumosdetalle'),
                 (N'dbo.gruposi'), (N'dbo.almacen'), (N'dbo.proveedores'), (N'dbo.acumuladoinsumos')) AS o(nombre)
     CROSS JOIN (VALUES (N'INSERT'), (N'UPDATE'), (N'DELETE'), (N'ALTER')) AS p(permiso)
     WHERE HAS_PERMS_BY_NAME(o.nombre, 'OBJECT', p.permiso) = 1
     ORDER BY o.nombre, p.permiso) AS obj_escritura_ejemplo;
