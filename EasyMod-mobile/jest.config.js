/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['@react-native-community/netinfo/jest/netinfo-mock.js'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/app/**/_layout.tsx'],
  // `lucide-react-native`'s package "exports" map is resolved by Jest via its "react-native"/
  // "import" condition (an ESM `.mjs` build) rather than its "require" (CJS) condition, and
  // jest-expo's babel-jest transform only matches `.js/.jsx/.ts/.tsx` — not `.mjs` — so the ESM
  // file reaches the VM untransformed and fails on the bare `export` syntax. Redirecting the bare
  // specifier straight at the package's own CJS build sidesteps both problems at once.
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
};
