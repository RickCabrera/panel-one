/**
 * Lo que un adaptador real le manda a su proveedor, ANTES de salir a la red.
 *
 * Las implementaciones reales (Facturama, Brevo) arman una `PeticionHttp` con una
 * función pura y se la dan a un `ClienteHttp`. Así el test de contrato fija la forma
 * exacta de la petición (snapshot) sin una sola llamada de red, y las credenciales
 * NO viven aquí: las agrega el cliente al mandar (`autenticacion`), para que ningún
 * snapshot ni log las vea.
 */
export interface PeticionHttp {
  metodo: 'GET' | 'POST' | 'DELETE';
  /** URL completa, con query string si lleva. */
  url: string;
  /** Cuerpo JSON. Ausente en GET/DELETE. */
  cuerpo?: unknown;
}

export interface RespuestaHttp {
  status: number;
  /** JSON parseado, o el texto crudo si el proveedor no mandó JSON. */
  cuerpo: unknown;
}

export interface ClienteHttp {
  enviar(peticion: PeticionHttp): Promise<RespuestaHttp>;
}

/** Tope de espera por petición. Un PAC que no contesta no debe colgar la cola de timbrado. */
export const TIMEOUT_HTTP_MS = 30_000;

/**
 * Cliente de `fetch` con timeout, para las implementaciones reales. `cabeceras` es
 * donde entra la credencial (Basic de Facturama, `api-key` de Brevo); se cierra en
 * este objeto y no se expone.
 */
export class ClienteFetch implements ClienteHttp {
  constructor(private readonly cabeceras: Readonly<Record<string, string>>) {}

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const respuesta = await fetch(peticion.url, {
      method: peticion.metodo,
      headers: {
        Accept: 'application/json',
        ...(peticion.cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...this.cabeceras,
      },
      body: peticion.cuerpo === undefined ? undefined : JSON.stringify(peticion.cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_HTTP_MS),
    });
    const texto = await respuesta.text();
    let cuerpo: unknown = texto;
    try {
      cuerpo = texto === '' ? null : JSON.parse(texto);
    } catch {
      // No era JSON: se queda el texto.
    }
    return { status: respuesta.status, cuerpo };
  }
}

/** Serializa un decimal de dinero/cantidad a número JSON SÓLO en el borde de la red. */
export function numeroJson(
  valor: { toFixed(decimales: number): string },
  decimales: number,
): number {
  return Number(valor.toFixed(decimales));
}
