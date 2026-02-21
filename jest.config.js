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
      '^@gradio/client$': '<rootDir>/__mocks__/@gradio/client.ts',
      '^@andresaya/edge-tts$': '<rootDir>/__mocks__/@andresaya/edge-tts.ts',
    },
  };