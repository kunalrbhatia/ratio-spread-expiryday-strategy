// Set mock environment variables for test execution
process.env.API_KEY = 'MOCK_API_KEY';
process.env.CLIENT_CODE = 'MOCK_CLIENT_CODE';
process.env.CLIENT_PIN = '1234';
process.env.CLIENT_TOTP_PIN = 'MOCK_TOTP_SECRET';
process.env.TELEGRAM_ENABLED = 'false';
process.env.SLACK_ENABLED = 'false';

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/server.ts'],
};

module.exports = config;
