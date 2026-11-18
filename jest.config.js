/** Dois projetos: `unit` (domínio, fila e regra de arquitetura) e `e2e` (HTTP e repositórios). */
const base = {
  rootDir: __dirname,
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testRegex: ['src/.*\\.spec\\.ts$', 'test/architecture\\.spec\\.ts$'] },
    { ...base, displayName: 'e2e', testRegex: ['test/.*\\.(e2e|contract)-spec\\.ts$'] },
  ],
  // Os adaptadores PostgreSQL só são exercitados com o banco ligado (`npm run test:pg`);
  // sem ele, ficam fora da conta em vez de derrubar o número com código que não rodou.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/__test__/**',
    ...(process.env.PERSISTENCE === 'postgres' ? [] : ['!src/**/infra/postgres/**']),
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: { global: { statements: 80, branches: 80, functions: 80, lines: 80 } },
};
