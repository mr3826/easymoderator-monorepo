// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', 'android/*', 'ios/*', '.expo/*', 'coverage/*'],
  },
  {
    files: ['**/*.test.{js,ts,tsx}', '**/__mocks__/**/*.js'],
    languageOptions: {
      globals: globals.jest,
    },
  },
];
