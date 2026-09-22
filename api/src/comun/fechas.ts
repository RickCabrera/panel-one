/**
 * ISO-8601 con zona OBLIGATORIA (`Z` u offset `±hh:mm`). Una fecha sin zona es
 * hora local de quién sabe dónde: se rechaza. Hasta 7 decimales de segundo
 * (lo que serializa .NET); se guardan milisegundos (`timestamptz(3)`).
 *
 * Vive aquí y no en la ingesta porque la usan la ingesta y el helper de scope de
 * ventas (`alturaAl`, F2-220). `ingesta/normalizar.ts` la reexporta.
 */
export const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;
