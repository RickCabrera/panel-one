using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Tests;

public class ConexionSoftRestaurantTests
{
    [Fact]
    public void Fuerza_nombre_de_aplicacion_intencion_de_lectura_y_timeout_corto()
    {
        var c = new ConexionSoftRestaurant(Datos.Cadena);
        var efectiva = new SqlConnectionStringBuilder(c.CadenaEfectiva);

        Assert.Equal("ArkonAgente", efectiva.ApplicationName);
        Assert.Equal(ApplicationIntent.ReadOnly, efectiva.ApplicationIntent);
        Assert.Equal(5, efectiva.ConnectTimeout);
        // Lo del técnico no se toca.
        Assert.True(efectiva.TrustServerCertificate);
        Assert.Equal("lector", efectiva.UserID);
        Assert.Equal("softrestaurant", efectiva.InitialCatalog);
    }

    [Theory]
    [InlineData("Connect Timeout=8", 8)]
    [InlineData("Connection Timeout=3", 3)]
    [InlineData("Timeout=60", 15)]
    [InlineData("Connect Timeout=0", 1)]
    public void Timeout_explicito_se_respeta_con_tope_de_15(string timeout, int esperado)
    {
        var c = new ConexionSoftRestaurant("Server=x;Database=y;User ID=u;Password=p;" + timeout);

        Assert.Equal(esperado, c.TimeoutConexion);
    }

    [Fact]
    public void Command_timeout_no_cuenta_como_timeout_de_conexion()
    {
        var c = new ConexionSoftRestaurant("Server=x;Database=y;User ID=u;Password=p;Command Timeout=90");

        Assert.Equal(5, c.TimeoutConexion);
    }

    [Fact]
    public void Resumen_no_trae_el_password()
    {
        var resumen = new ConexionSoftRestaurant(Datos.Cadena).Resumen();

        Assert.Equal("servidor=127.0.0.1\\SQLEXPRESS, base=softrestaurant, usuario=lector", resumen);
        Assert.DoesNotContain(Datos.Password, resumen);
    }

    [Fact]
    public void Detecta_autenticacion_de_windows()
    {
        var c = new ConexionSoftRestaurant("Server=x;Database=y;Integrated Security=True");

        Assert.True(c.UsaAutenticacionWindows);
        Assert.Contains("autenticación de Windows", c.Resumen());
        Assert.False(new ConexionSoftRestaurant(Datos.Cadena).UsaAutenticacionWindows);
    }
}
