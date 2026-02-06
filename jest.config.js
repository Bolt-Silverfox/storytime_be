// jest.config.js
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    rootDir: '.',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    transform: {
      '^.+\\.(t|j)sx?$': 'ts-jest',
    },
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: './coverage',
    testEnvironment: 'node',
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '^src/(.*)$': '<rootDir>/src/$1',
      '^googleapis$': '<rootDir>/__mocks__/googleapis.ts',
    },
  };