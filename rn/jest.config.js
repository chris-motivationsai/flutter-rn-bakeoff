// Two kinds of tests:
//  - "core": plain Node. The core, the adapters' pure parts and the scenario runner, with Node's own fetch,
//    Node's SQLite and the C++ engine addon, talking to the kit's real test server.
//  - "ui": the React Native screens under jest-expo, wired to the same core, plus the real device adapters
//    (tests/device) run against mocked native libraries.
const shared = {
  moduleNameMapper: { '^zod$': '<rootDir>/node_modules/zod' },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/core/**/*.test.ts', '<rootDir>/tests/adapters/**/*.test.ts', '<rootDir>/tests/runner/**/*.test.ts'],
      transform: { '\\.[jt]sx?$': 'babel-jest' },
      transformIgnorePatterns: ['/node_modules/(?!(fast-png|iobuffer|pako)/)'], // ESM-only packages
    },
    {
      ...shared,
      displayName: 'ui',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx', '<rootDir>/tests/device/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/tests/helpers/quietAct.ts'],
    },
  ],
};
