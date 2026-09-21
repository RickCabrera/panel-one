import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';
import { aplicarAcento, leerAcento } from './tema/acento';

const contenedor = document.getElementById('root');

if (!contenedor) {
  throw new Error('No existe #root en index.html');
}

aplicarAcento(leerAcento(import.meta.env.VITE_COLOR_ACENTO as string | undefined));

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
