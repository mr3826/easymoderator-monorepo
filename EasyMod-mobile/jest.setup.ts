import { configure } from '@testing-library/react-native';

import { queryClient } from '@/lib/queryClient';

// The first render in a file lazily transforms and loads most of React Native. On a cold Jest
// cache (every CI run) that alone can exceed RNTL's 1 s `findBy*`/`waitFor` default, which made
// deep-link and login assertions fail intermittently without any product defect.
configure({ asyncUtilTimeout: 10_000 });

// The app's singleton client schedules a `gcTime` (5 min) timer for every inactive query. Clearing
// it after each test removes those timers so Jest workers exit cleanly without `--forceExit`, and
// no cached server state can leak from one test into the next.
afterEach(() => {
  queryClient.clear();
});
