/**
 * Puerto de almacenamiento de archivos (F2-202): XML y PDF de las facturas (F2-105),
 * y lo que venga. Lo consume quien inyecte `PUERTO_ARCHIVOS`.
 *
 * La clave es una ruta relativa con `/` (p. ej. `empresa/<id>/cfdi/<uuid>.xml`). Se
 * valida SIEMPRE: nada de `..`, rutas absolutas ni `\`.
 */
export interface PuertoArchivos {
  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void>;
  /** Truena con `ArchivoNoEncontrado` si la clave no existe. */
  leer(clave: string): Promise<Buffer>;
  /** URL de descarga que vence en `ttlSegundos`. */
  urlFirmada(clave: string, ttlSegundos: number): Promise<string>;
  /**
   * ¿`expira` y `firma` (los parámetros de una URL de `urlFirmada`) son válidos para `clave` en
   * este instante? Vencida, alterada o con una clave inválida = false. Lo usa el endpoint de
   * descarga (F2-105); el secreto se queda dentro del adaptador.
   */
  verificarUrl(clave: string, expira: number, firma: string): boolean;
}

export class ArchivoNoEncontrado extends Error {
  constructor(readonly clave: string) {
    super(`No existe el archivo ${clave}.`);
    this.name = 'ArchivoNoEncontrado';
  }
}
