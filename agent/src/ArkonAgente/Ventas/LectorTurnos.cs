using System.Data;
using System.Data.Common;
using System.Diagnostics;
using ArkonAgente.Catalogos;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Ventas;

/// <summary>Lo que devolvió una lectura de turnos y lo que tardó.</summary>
internal sealed record LecturaTurnos(IReadOnlyList<FilaTurno> Filas, long Milisegundos);

/// <summary>Lee los turnos de SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorTurnos
{
    /// <summary>Lo mismo que <see cref="ILectorCatalogos.RevisarPermisosAsync"/>: sólo con SOLO LECTURA confirmado.</summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>
    /// Los turnos abiertos y los abiertos o cerrados desde <paramref name="desde"/> (hora LOCAL de
    /// SR). Lanza si falla: el que llama nunca lo toma por "no hay turnos".
    /// </summary>
    Task<LecturaTurnos> LeerAsync(DateTime desde, CancellationToken cancelacion);
}

/// <summary>
/// El lector real: <c>sr_turnos.sql</c> (la que diga el reader elegido por versión) por
/// <see cref="ConexionSoftRestaurant.CrearComando"/>: timeout corto, <c>WITH (NOLOCK)</c> en el
/// <c>.sql</c>, sin transacción. SOLO LECTURA.
/// </summary>
internal sealed class LectorTurnosSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader) : ILectorTurnos
{
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        LectorCatalogosSr.RevisarPermisosAsync(conexion, cancelacion);

    public async Task<LecturaTurnos> LeerAsync(DateTime desde, CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, reader.ConsultaTurnos);
            comando.Parameters.Add("@desde", SqlDbType.DateTime).Value = desde;
            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);
            var filas = new List<FilaTurno>();
            while (await lector.ReadAsync(cancelacion))
            {
                filas.Add(new FilaTurno(
                    Entero(lector, "idturno"), Fecha(lector, "apertura"), Fecha(lector, "cierre"),
                    Texto(lector, "idestacion"), Dinero(lector, "fondo"), Dinero(lector, "efectivo"),
                    Dinero(lector, "tarjeta"), Dinero(lector, "vales"), Dinero(lector, "credito")));
            }

            return new LecturaTurnos(filas, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }

    private static long? Entero(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToInt64(lector.GetValue(i));
    }

    private static decimal? Dinero(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToDecimal(lector.GetValue(i));
    }

    private static string? Texto(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToString(lector.GetValue(i));
    }

    private static DateTime? Fecha(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : lector.GetDateTime(i);
    }
}
