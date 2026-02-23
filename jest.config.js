// jest.config.js
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    rootDir: '.',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    transform: {
      '^.+\\.(t|j)sx?$': 'ts-jest',
    },
    transformIgnorePatterns: [
      '/node_modules/(?!uuid)/',
    ],
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: './coverage',
    coverageThreshold: {
      global: {
        branches: 60,
        functions: 60,
        lines: 70,
        statements: 70,
      },
    },
    testEnvironment: 'node',
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '^src/(.*)$': '<rootDir>/src/$1',
      '^googleapis$': '<rootDir>/__mocks__/googleapis.ts',
      '^uuid$': '<rootDir>/__mocks__/uuid.ts',
      '^@gradio/client$': '<rootDir>/__mocks__/@gradio/client.ts',
      '^@andresaya/edge-tts$': '<rootDir>/__mocks__/@andresaya/edge-tts.ts',
    },
  };