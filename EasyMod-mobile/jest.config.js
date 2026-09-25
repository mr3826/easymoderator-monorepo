/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // The first test in a component file pays for transforming and loading React Native itself.
  // With a cold cache on a loaded runner that measured 5-12 s, over Jest's 5 s default, and failed
  // otherwise-passing tests at random (login-screen, AuthProvider cold-start, deeplink-routes).
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/app/**/_layout.tsx'],
  // `lucide-react-native`'s package "exports" map is resolved by Jest via its "react-native"/
  // "import" condition (an ESM `.mjs` build) rather than its "require" (CJS) condition, and
  // jest-expo's babel-jest transform only matches `.js/.jsx/.ts/.tsx` — not `.mjs` — so the ESM
  // file reaches the VM untransformed and fails on the bare `export` syntax. Redirecting the bare
  // specifier straight at the package's own CJS build sidesteps both problems at once.
  //
  // `@react-native-community/netinfo` previously listed its own `jest/netinfo-mock.js` under
  // `setupFiles`, but a `setupFiles` entry only *executes* that script (defining an unused local
  // mock object) — it never intercepts `import NetInfo from '@react-native-community/netinfo'`,
  // so application code kept getting the *real* native module. No existing test noticed because
  // none of them mounted `_layout.tsx` (every prior `renderRouter` call scoped to a subtree, e.g.
  // `(tabs)/__tests__/tab-shell.test.tsx` rendering only `(tabs)`); Phase 2 Lane 4's
  // `deeplink-routes.test.tsx` is the first to render the full app root to exercise its
  // signed-in-only route guard, which mounts `_layout.tsx`'s `OfflineBanner` →
  // `useNetworkStatus` → `NetInfo.addEventListener`, which then crashed trying to read
  // `isInternetReachable` off a native state object that doesn't exist under Jest. Routing the
  // bare specifier at the package's own official Jest mock (same technique as the
  // `lucide-react-native` line above) makes `addEventListener` the mock's inert `jest.fn()`
  // instead, fixing this for every test file, not just this lane's.
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^@react-native-community/netinfo$':
      '<rootDir>/node_modules/@react-native-community/netinfo/jest/netinfo-mock.js',
    // AsyncStorage (ADR M-011 persisted cache) is a native module; use the package's own in-memory
    // Jest mock, same technique as NetInfo above.
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
  },
};
