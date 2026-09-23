#!/usr/bin/env node
// F2-250 · Verifica docs/paridad.md: cada renglón de las tablas de capacidades apunta a
// código que existe o a una tarea que existe en backlog.md (y ninguna referencia está
// rota: toda ruta citada existe y todo id citado es una tarea del backlog).
//
// Uso, desde la raíz del repo:   node scripts/auditoria/paridad.mjs
// Sale con 0 si todo cuadra, con 1 si algún renglón no apunta a nada o cita algo roto.
// No está conectado al CI a propósito (F2-250 no agrega gates); ver backlog, Ronda 3.

import { existsSync, readFileSync } from 'node:fs';

const PARIDAD = 'docs/paridad.md';
const backlog = readFileSync('backlog.md', 'utf8');

// Una tarea existe si tiene encabezado propio (### F2-120 · …, ## F2-190 · …).
const tareas = new Set(
  [...backlog.matchAll(/^#{2,4}\s+(F\d-\d{3}b?)\s·/gm)].map((m) => m[1]),
);

// Rutas: lo que va entre backticks y parece ruta del repo (empieza por una carpeta conocida,
// o es un .md de la raíz como README.md). Se ignora un sufijo :línea.
const RAICES = /^((api|web|agent|infra|docs|scripts|\.github)\/|[\w.-]+\.md$)/;

const errores = [];
let filas = 0;
for (const [n, linea] of readFileSync(PARIDAD, 'utf8').split('\n').entries()) {
  if (!/^\|/.test(linea) || /^\|\s*-/.test(linea)) continue;
  // Sólo las tablas de capacidades: su primera celda lleva el id de la tarea en negrita.
  if (!/^\|\s*\*\*F\d-\d{3}b?\*\*/.test(linea)) continue;
  filas += 1;
  const rutas = [...linea.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1].replace(/:\d+(-\d+)?$/, ''))
    .filter((r) => RAICES.test(r));
  const ids = [...linea.matchAll(/\b(F\d-\d{3}b?)\b/g)].map((m) => m[1]);
  // La primera celda es la tarea de origen; lo que cuenta como "apunta a" son las demás.
  const [, , ...resto] = linea.split('|');
  const idsDestino = [...resto.join('|').matchAll(/\b(F\d-\d{3}b?)\b/g)].map((m) => m[1]);
  for (const r of rutas) if (!existsSync(r)) errores.push(`L${n + 1}: ruta inexistente ${r}`);
  for (const id of ids) if (!tareas.has(id)) errores.push(`L${n + 1}: tarea inexistente ${id}`);
  if (rutas.length === 0 && idsDestino.length === 0) {
    errores.push(`L${n + 1}: el renglón no apunta ni a código ni a una tarea`);
  }
}

console.log(`Renglones de capacidades en ${PARIDAD}: ${filas}`);
if (filas === 0) errores.push('no se encontró ningún renglón de capacidades');
if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log('OK: cada renglón apunta a código existente o a una tarea del backlog.');
