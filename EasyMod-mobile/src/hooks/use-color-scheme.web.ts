import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    // Web-only hydration guard from the Expo template baseline (web is not a target platform for
    // this program — Android-first, iOS out of scope per ADR M-002 — kept as-is rather than
    // rearchitected). This one-time "we're on the client now" flip is the documented escape
    // hatch for the static-rendering hydration mismatch this hook exists to solve, not state
    // meant to synchronize with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
