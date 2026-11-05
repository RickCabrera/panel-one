import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// UI-02: fuentes empaquetadas (la CSP no deja traerlas de fuera). Sólo latin y los pesos que
// se usan: Inter 400 a 700 para datos y Outfit 600/700 para títulos.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';

import App from './App';
import './index.css';
import { registrarServiceWorker } from './pwa/registrar';
import { acentoEfectivo, leerAcentoGuardado } from './tema/acento';
import { iniciarTema } from './tema/tema';

const contenedor = document.getElementById('root');

if (!contenedor) {
  throw new Error('No existe #root en index.html');
}

// Antes del primer render (F2-211): la última preferencia de tema de este navegador, con el
// último color global de la plataforma que vio (membresías), o el del build.
iniciarTema(acentoEfectivo(leerAcentoGuardado()));

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// F2-146: la PWA (instalable, armazón sin red y avisos push). Sólo en el build.
registrarServiceWorker();
