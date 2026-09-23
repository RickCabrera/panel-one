#!/usr/bin/env node
// F2-250 · Verifica que cada marca de decisión provisional del código tenga su renglón
// en el índice de docs/esquema-sr.md ("Índice de decisiones provisionales") y que el §
// que ese renglón cita exista como encabezado del documento.
//
// Uso, desde la raíz del repo:   node scripts/auditoria/decisiones-provisionales.mjs
// Con --listar imprime las ocurrencias con su clave (útil para rehacer el índice).
// Sale con 0 si cuadra N/N, con 1 si falta o sobra algún renglón o un § no existe.
// No está conectado al CI a propósito (F2-250 no agrega gates); ver backlog, Ronda 3.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// La marca, tolerante a: mayúsculas/minúsculas, acento en la Ó, y a que el comentario
// parta la frase en dos líneas (`DECISION` / ` *   PROVISIONAL`, `//`, `#`, `--`).
const MARCA = /DECISI[OÓ]N\s*(?:\*|\/\/|#|--|<!--)?\s*PROVISIONAL/gi;
const CARPETAS = ['api', 'web', 'agent', 'infra', 'scripts'];
const FUERA = [/(^|\/)node_modules\//, /^scripts\/auditoria\//, /(^|\/)(bin|obj|dist|dist-landing)\//];
const ESQUEMA = 'docs/esquema-sr.md';

function ocurrencias() {
  const archivos = execFileSync('git', ['ls-files', '--', ...CARPETAS], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !FUERA.some((re) => re.test(f)));
  const lista = [];
  for (const archivo of archivos) {
    let texto;
    try {
      texto = readFileSync(archivo, 'utf8');
    } catch {
      continue;
    }
    if (texto.includes('\u0000')) continue; // binario
    let k = 0;
    for (const m of texto.matchAll(MARCA)) {
      k += 1;
      const linea = texto.slice(0, m.index).split('\n').length;
      lista.push({ clave: `${archivo}#${k}`, archivo, linea });
    }
  }
  return lista;
}

function indice(esquema) {
  const inicio = esquema.indexOf('## Índice de decisiones provisionales');
  if (inicio < 0) return null;
  const renglones = new Map();
  for (const l of esquema.slice(inicio).split('\n')) {
    const m = l.match(/^\|\s*`([^`]+#\d+)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const celdas = m[2].split('|').map((c) => c.trim());
    renglones.set(m[1], { celdas, texto: l });
  }
  return renglones;
}

function encabezados(esquema) {
  return esquema
    .split('\n')
    .filter((l) => /^#{2,4}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, ''));
}

// "§10" → existe "## 10. …"; "§2 «Control de folios»" → además un encabezado que
// contenga ese texto. Varias referencias separadas por coma o " y ".
function referenciasRotas(celda, heads) {
  const rotas = [];
  const refs = [...celda.matchAll(/§(\d+)(?:\s*«([^»]+)»)?/g)];
  if (refs.length === 0) return ['(sin §)'];
  for (const [, num, sub] of refs) {
    if (!heads.some((h) => h.startsWith(`${num}. `))) rotas.push(`§${num}`);
    else if (sub && !heads.some((h) => h.includes(sub))) rotas.push(`§${num} «${sub}»`);
  }
  return rotas;
}

const lista = ocurrencias();
if (process.argv.includes('--listar')) {
  for (const o of lista) console.log(`${o.clave}\t${o.archivo}:${o.linea}`);
  process.exit(0);
}

const esquema = readFileSync(ESQUEMA, 'utf8');
const idx = indice(esquema);
if (!idx) {
  console.error(`FALTA la sección "Índice de decisiones provisionales" en ${ESQUEMA}`);
  process.exit(1);
}
const heads = encabezados(esquema);
const errores = [];
for (const o of lista) {
  const r = idx.get(o.clave);
  if (!r) {
    errores.push(`sin renglón en el índice: ${o.clave} (${o.archivo}:${o.linea})`);
    continue;
  }
  const seccion = r.celdas[r.celdas.length - 1];
  for (const rota of referenciasRotas(seccion, heads)) {
    errores.push(`${o.clave}: la referencia ${rota} no es un encabezado de ${ESQUEMA}`);
  }
}
const claves = new Set(lista.map((o) => o.clave));
for (const clave of idx.keys()) {
  if (!claves.has(clave)) errores.push(`renglón sobrante (ya no está en el código): ${clave}`);
}

const documentadas = lista.length - errores.filter((e) => e.startsWith('sin renglón')).length;
console.log(`Decisiones provisionales en el código: ${lista.length}`);
console.log(`Con renglón en el índice: ${documentadas}/${lista.length}`);
if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log('OK: cada ocurrencia tiene su renglón y cada § existe.');
