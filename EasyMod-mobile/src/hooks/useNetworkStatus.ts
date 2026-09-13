import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Simple online/offline signal (ADR M-011). No mutation queue exists in this program, so all
 * this needs to drive is: show a persistent offline banner, and let screens disable mutating
 * actions (order confirm/cancel, courier book, reply send, stock update) while offline — the
 * action is unavailable, never silently deferred.
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // Treat "unknown" reachability as online rather than flashing the banner on every
      // transient platform-reported ambiguity; an actual request failure is what ultimately
      // surfaces as a `network`-kind normalized error regardless of this signal.
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return () => unsubscribe();
  }, []);

  return isOnline;
}
