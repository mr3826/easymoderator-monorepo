import type { DeepLinkEntityKind } from './deeplink';

/**
 * Holds one inbound entity deep link until the signed-in app shell can open it (audit P1-5).
 *
 * Expo Router matches a cold-launch URL once, while `_layout.tsx` is still resolving auth and the
 * protected entity screens do not exist yet, so a direct `order/<id>` launch used to fall back to
 * Home. A signed-out launch has the same problem after login. `+native-intent.ts` therefore parks
 * every inbound entity link here and routes to `/`; `RootNavigator` replays it through
 * `openDeepLink` once `status === 'signedIn'`. Authorization is unchanged: the entity screen still
 * resolves the id through the shop-scoped API, so a parked link for another shop shows
 * "unavailable".
 */

/** A link parked longer than this (e.g. left on the login screen) is dropped, not replayed. */
export const PENDING_DEEP_LINK_TTL_MS = 10 * 60 * 1000;

export interface PendingDeepLink {
  kind: DeepLinkEntityKind;
  id: string;
}

let pending: (PendingDeepLink & { at: number }) | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

// Accepts an app URL (`scheme://order/<id>`) or a router path (`/order/<id>`), optionally with a
// query string or fragment. Anything else, including an empty id, is not an entity link.
const ENTITY_PATH = /^\/*(order|conversation)\/([^/?#]+)\/?(?:[?#].*)?$/;

export function parseEntityDeepLink(path: string): PendingDeepLink | null {
  const withoutScheme = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const match = ENTITY_PATH.exec(withoutScheme);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return id ? { kind: match[1] as DeepLinkEntityKind, id } : null;
}

export function capturePendingDeepLink(link: PendingDeepLink, now: number = Date.now()): void {
  pending = { ...link, at: now };
  notify();
}

/** Returns and clears the parked link, or null if there is none or it has expired. */
export function takePendingDeepLink(now: number = Date.now()): PendingDeepLink | null {
  if (!pending) return null;
  const { kind, id, at } = pending;
  pending = null;
  return now - at > PENDING_DEEP_LINK_TTL_MS ? null : { kind, id };
}

export function subscribePendingDeepLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever a link is parked; lets React re-run the replay effect. */
export function getPendingDeepLinkVersion(): number {
  return version;
}

/** Test-only escape hatch (mirrors `__resetDeepLinkDedupeForTests`). */
export function __resetPendingDeepLinkForTests(): void {
  pending = null;
}
