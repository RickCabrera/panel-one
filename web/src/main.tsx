import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';
import { registrarServiceWorker } from './pwa/registrar';
import { ACENTO_DESPLIEGUE } from './tema/acento';
import { iniciarTema } from './tema/tema';

const contenedor = document.getElementById('root');

if (!contenedor) {
  throw new Error('No existe #root en index.html');
}

// Antes del primer render (F2-211): la última preferencia de tema de este navegador.
iniciarTema(ACENTO_DESPLIEGUE);

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// F2-146: la PWA (instalable, armazón sin red y avisos push). Sólo en el build.
registrarServiceWorker();
