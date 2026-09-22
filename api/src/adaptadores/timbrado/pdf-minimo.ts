/**
 * PDF 1.4 de una página escrito a mano, sin dependencias: lo usa el PAC falso para
 * la representación impresa (que va marcada NO FISCAL). Helvetica estándar, así que
 * el texto se pasa a ASCII (los acentos se quitan; lo demás fuera de ASCII imprimible
 * sale como "?"). La tabla xref lleva los offsets en BYTES reales: un lector estricto
 * rechaza un PDF con offsets inventados.
 */

function aAscii(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function literal(texto: string): string {
  return `(${aAscii(texto).replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

export interface LineaPdf {
  texto: string;
  /** Puntos. Por defecto 11. */
  tamano?: number;
}

export function pdfMinimo(lineas: LineaPdf[]): Buffer {
  const contenido = [
    'BT',
    '50 740 Td',
    ...lineas.flatMap((l, i) => [
      `/F1 ${l.tamano ?? 11} Tf`,
      `${literal(l.texto)} Tj`,
      ...(i < lineas.length - 1 ? [`0 -${Math.round((l.tamano ?? 11) * 1.6)} Td`] : []),
    ]),
    'ET',
  ].join('\n');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((cuerpo, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
