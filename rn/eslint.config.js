const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'node_modules/*', 'modules/strip-engine/node/build/*', 'modules/strip-engine/ios/cpp/*'] },
  // A zod schema and its inferred type share one name (the kit's own convention); TypeScript allows that.
  { rules: { '@typescript-eslint/no-redeclare': 'off' } },
  {
    files: ['tests/**', 'jest.config.js'],
    languageOptions: { globals: { jest: 'readonly', describe: 'readonly', test: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' } },
  },
]);
