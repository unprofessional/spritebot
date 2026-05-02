process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/jest.globalSetup.cjs',
  globalTeardown: '<rootDir>/tests/jest.globalTeardown.cjs',
  setupFiles: ['dotenv/config'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.cjs'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  testMatch: ['**/?(*.)+(test).[tj]s'],
  moduleFileExtensions: ['ts', 'js', 'cjs'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@electric-sql/pglite$': '<rootDir>/node_modules/@electric-sql/pglite/dist/index.cjs',
    '^@client/(.*)$': '<rootDir>/src/client/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^types/(.*)$': '<rootDir>/src/types/$1',
  },
  maxWorkers: '50%',
  verbose: true,
};
