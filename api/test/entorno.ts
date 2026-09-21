// `setupFiles` de jest: corre antes de cada archivo de tests.
//
// Secretos JWT de PRUEBA, sintéticos, sólo si el entorno no trae los suyos. No
// firman nada fuera de los tests. `leerAuthConfig()` sigue exigiéndolos en
// cualquier otro arranque: esto no afloja esa validación, sólo la satisface
// en la corrida de tests.
process.env.JWT_ACCESS_SECRET ??= 'secreto-access-de-pruebas-sintetico-no-usar-0001';
process.env.JWT_REFRESH_SECRET ??= 'secreto-refresh-de-pruebas-sintetico-no-usar-0002';
