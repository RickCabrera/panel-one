import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL_PANEL_POR_DEFECTO, resolverUrlPanel, rutaDeRespaldo } from '../url-panel.cjs';

test('sin YC_URL_PANEL usa el panel de Railway', () => {
  assert.equal(resolverUrlPanel(undefined), 'https://web-production-730b5.up.railway.app/');
  assert.equal(resolverUrlPanel(''), 'https://web-production-730b5.up.railway.app/');
  assert.equal(resolverUrlPanel('   '), 'https://web-production-730b5.up.railway.app/');
});

test('normaliza un dominio propio al origen con / final', () => {
  assert.equal(resolverUrlPanel('https://panel.yocontrolo.mx'), 'https://panel.yocontrolo.mx/');
  assert.equal(resolverUrlPanel(' https://Panel.YoControlo.mx/ '), 'https://panel.yocontrolo.mx/');
});

test('rechaza lo que no debe armarse en un APK', () => {
  for (const malo of [
    'http://panel.yocontrolo.mx', // cleartext apagado
    'panel.yocontrolo.mx',
    'https://usuario:clave@panel.yocontrolo.mx',
    'https://panel.yocontrolo.mx/?x=1',
    'https://panel.yocontrolo.mx/#x',
    'https://panel.yocontrolo.mx/ventas', // la cookie y /api viven en la raíz del origen
    'javascript:alert(1)',
  ]) {
    assert.throws(() => resolverUrlPanel(malo), /YC_URL_PANEL/, malo);
  }
});

test('la ruta de respaldo lleva el panel codificado en ?panel=', () => {
  const ruta = rutaDeRespaldo(URL_PANEL_POR_DEFECTO + '/');
  assert.equal(ruta, 'index.html?panel=https%3A%2F%2Fweb-production-730b5.up.railway.app%2F');
  const leido = new URL(ruta, 'https://localhost/').searchParams.get('panel');
  assert.equal(leido, 'https://web-production-730b5.up.railway.app/');
});

test('la pantalla de respaldo es autocontenida y trae el mismo panel por defecto', () => {
  const html = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
  // Capacitor sólo sirve la página de respaldo misma desde https://localhost: nada externo.
  assert.doesNotMatch(html, /<(link|img|script)[^>]+(href|src)=/i);
  assert.match(html, /Sin conexión\. Revisa tu internet y vuelve a intentar\./);
  assert.match(html, /id="reintentar"/);
  assert.ok(
    html.includes(`'${URL_PANEL_POR_DEFECTO}/'`),
    'POR_DEFECTO del respaldo = url-panel.cjs',
  );
});
