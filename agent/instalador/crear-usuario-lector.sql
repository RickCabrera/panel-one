-- =============================================================================
-- ArkonAgente · Crea el usuario SQL de SOLO LECTURA para el agente del monitor.
--
-- Qué hace:    crea el login `monitor_lector` y lo mete a la base de SoftRestaurant
--              con el rol db_datareader. NADA MÁS: ningún otro rol, ningún GRANT.
-- Qué NO hace: no toca ninguna tabla de SoftRestaurant, no cambia la configuración
--              del servidor y no le quita permisos a nadie.
--
-- No se corre a mano: lo corre `crear-usuario-lector.ps1` (guía:
-- docs/instalacion-agente.md, paso 3), que pide la contraseña sin que quede en el
-- historial de la consola y se la pasa a sqlcmd por variable de entorno:
--
--   BASE_SR          nombre de la base de SoftRestaurant (p. ej. softrestaurant10)
--   PASSWORD_LECTOR  la contraseña de monitor_lector
--
-- Si falta alguna de las dos, sqlcmd se detiene antes de mandar nada al servidor.
--
-- Volver a correrlo es seguro: si el usuario ya existe y sólo puede leer, le repone la
-- contraseña y nada más (después hay que correr `instalar.ps1 -ReemplazarConfig`).
--
-- Se detiene SIN CAMBIAR NADA si:
--   - el SQL Server sólo acepta usuarios de Windows (cambiarlo reinicia el SQL del POS:
--     eso lo decide soporte, no este script);
--   - la base no existe, o es una base de sistema;
--   - `monitor_lector` ya existe con MÁS permisos que leer (un rol de servidor, un permiso
--     de servidor, otro rol en la base, un GRANT propio, o es el dueño de la base), o su
--     usuario en la base pertenece a otro login. No se los quita: avisa.
--
-- T-SQL compatible con SQL Server 2008 en adelante (por eso sp_addrolemember y no
-- ALTER ROLE ... ADD MEMBER, que llegó en 2012; y por eso no usa IS_ROLEMEMBER).
-- Los mensajes van sin acentos: la consola de sqlcmd no siempre los muestra bien.
--
-- La guardia de los tests (agent/tests/ArkonAgente.Tests/InstaladorSqlTests.cs) falla si
-- este archivo otorga algo distinto de db_datareader o usa SQL dinámico.
-- =============================================================================
:on error exit

USE [$(BASE_SR)];
GO

SET NOCOUNT ON;

DECLARE @login sysname;
SET @login = N'monitor_lector';

IF CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int) = 1
BEGIN
    RAISERROR(N'ALTO: este SQL Server solo acepta usuarios de Windows (no esta en "modo mixto"). No se cambio nada. Cambiar el modo reinicia el SQL de SoftRestaurant: llama a soporte.', 16, 1);
    RETURN;
END

IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
BEGIN
    RAISERROR(N'ALTO: la base elegida es una base de sistema. Elige la base de SoftRestaurant (por ejemplo softrestaurant10). No se cambio nada.', 16, 1);
    RETURN;
END

-- Un login existente con cualquier rol de servidor (sysadmin, securityadmin, ...) o con
-- permisos de servidor además de conectarse (COSQ = CONNECT SQL): no es de solo lectura.
IF EXISTS (SELECT 1
           FROM sys.server_role_members AS m
           JOIN sys.server_principals AS p ON p.principal_id = m.member_principal_id
           WHERE p.name = @login)
   OR EXISTS (SELECT 1
              FROM sys.server_permissions AS sp
              JOIN sys.server_principals AS p ON p.principal_id = sp.grantee_principal_id
              WHERE p.name = @login
                AND sp.type <> 'COSQ'
                AND sp.state IN ('G', 'W'))
BEGIN
    RAISERROR(N'ALTO: el login monitor_lector ya existe y tiene permisos de servidor (por ejemplo sysadmin). No se cambio nada. Pide a soporte que se los quite o que lo borre, y vuelve a correr este script.', 16, 1);
    RETURN;
END

-- El dueño de la base es dbo: puede todo, aunque no esté en ningún rol.
IF EXISTS (SELECT 1
           FROM sys.databases AS d
           JOIN sys.server_principals AS p ON p.sid = d.owner_sid
           WHERE d.name = DB_NAME()
             AND p.name = @login)
BEGIN
    RAISERROR(N'ALTO: el login monitor_lector es el DUENO de esta base (puede todo). No se cambio nada. Llama a soporte.', 16, 1);
    RETURN;
END

-- Un usuario existente en la base con otro rol además de db_datareader, o con permisos
-- propios además de conectarse (CO = CONNECT): tampoco.
IF EXISTS (SELECT 1
           FROM sys.database_role_members AS m
           JOIN sys.database_principals AS u ON u.principal_id = m.member_principal_id
           JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
           WHERE u.name = @login
             AND r.name <> N'db_datareader')
   OR EXISTS (SELECT 1
              FROM sys.database_permissions AS dp
              JOIN sys.database_principals AS u ON u.principal_id = dp.grantee_principal_id
              WHERE u.name = @login
                AND dp.type <> 'CO'
                AND dp.state IN ('G', 'W'))
BEGIN
    RAISERROR(N'ALTO: el usuario monitor_lector ya existe en esta base con mas permisos que leer (otro rol o un GRANT). No se cambio nada. Pide a soporte que se los quite, y vuelve a correr este script.', 16, 1);
    RETURN;
END

-- Un usuario monitor_lector que no pertenece a ESTE login (base restaurada de otra PC, o
-- un login borrado): el agente entraría al servidor pero no a la base.
IF EXISTS (SELECT 1
           FROM sys.database_principals AS u
           WHERE u.name = @login
             AND NOT EXISTS (SELECT 1 FROM sys.server_principals AS p
                             WHERE p.sid = u.sid AND p.name = @login))
BEGIN
    RAISERROR(N'ALTO: en esta base ya hay un usuario monitor_lector que no pertenece al login monitor_lector de este servidor (base restaurada de otra PC?). No se cambio nada. Llama a soporte.', 16, 1);
    RETURN;
END

-- Sólo aviso: si `public` puede escribir, cualquier usuario de la base puede, también el
-- lector. El script no lo cambia (no es nuestro); `agente test` lo marca a nivel base.
IF EXISTS (SELECT 1
           FROM sys.database_permissions AS dp
           JOIN sys.database_principals AS g ON g.principal_id = dp.grantee_principal_id
           WHERE g.name = N'public'
             AND dp.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'EXECUTE', N'ALTER', N'CONTROL', N'TAKE OWNERSHIP')
             AND dp.state IN ('G', 'W'))
BEGIN
    PRINT N'AVISO: en esta base el rol public tiene permisos de escritura o de ejecucion. monitor_lector los hereda. Avisale a soporte (el agente de todos modos solo hace SELECT).';
END

-- 1) El login. Si ya existe: sólo se repone la contraseña.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals AS p WHERE p.name = @login)
BEGIN
    CREATE LOGIN [monitor_lector]
        WITH PASSWORD = N'$(PASSWORD_LECTOR)',
             CHECK_POLICY = ON,
             CHECK_EXPIRATION = OFF,
             DEFAULT_DATABASE = [master];
    PRINT N'Login monitor_lector creado.';
END
ELSE
BEGIN
    ALTER LOGIN [monitor_lector] WITH PASSWORD = N'$(PASSWORD_LECTOR)';
    PRINT N'El login monitor_lector ya existia: se le CAMBIO la contrasena a la que acabas de escribir. Si el agente ya estaba instalado, corre instalar.ps1 -ReemplazarConfig con la nueva.';
    IF EXISTS (SELECT 1 FROM sys.server_principals AS p WHERE p.name = @login AND p.is_disabled = 1)
    BEGIN
        PRINT N'AVISO: el login monitor_lector esta DESHABILITADO: el agente no va a poder entrar. Alguien lo deshabilito a proposito; pregunta a soporte antes de habilitarlo.';
    END
END

-- 2) El usuario en la base de SoftRestaurant.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals AS u WHERE u.name = @login)
BEGIN
    CREATE USER [monitor_lector] FOR LOGIN [monitor_lector];
    PRINT N'Usuario monitor_lector creado en la base.';
END

-- 3) Sólo lectura. Éste es el ÚNICO permiso que otorga el script.
IF NOT EXISTS (SELECT 1
               FROM sys.database_role_members AS m
               JOIN sys.database_principals AS u ON u.principal_id = m.member_principal_id
               JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
               WHERE u.name = @login
                 AND r.name = N'db_datareader')
BEGIN
    EXEC sp_addrolemember N'db_datareader', N'monitor_lector';
END

PRINT N'Listo: monitor_lector solo puede LEER la base ' + DB_NAME() + N'.';
GO
