import 'reflect-metadata';

import { writeFileSync } from 'node:fs';

import { generarDocumento, RUTA_OPENAPI, serializar } from './documento';

// `npm run openapi`: regenera api/openapi.json. Se corre cada vez que cambia un
// endpoint o un DTO, y el resultado se commitea en el mismo entregable.
generarDocumento()
  .then((documento) => {
    writeFileSync(RUTA_OPENAPI, serializar(documento), 'utf8');
    console.log(`Contrato escrito en ${RUTA_OPENAPI}`);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
