/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // `prisma/` también: ahí viven los tests del esquema y del seed (F1-010), que
  // corren contra el Postgres de DATABASE_URL. Sin base, fallan; no se saltan.
  // Van EN SERIE (`--runInBand` en `npm test`): todos comparten ese Postgres y
  // el test del seed fotografía tablas enteras; en paralelo, los fixtures de un
  // archivo se colarían en la foto del otro.
  roots: ['<rootDir>/src', '<rootDir>/prisma', '<rootDir>/scripts'],
  testRegex: '.*\\.spec\\.ts$',
  // Secretos JWT sintéticos para los tests (sólo si el entorno no trae otros).
  setupFiles: ['<rootDir>/test/entorno.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
  testEnvironment: 'node',
};
