/**
 * The access token lives in memory only, never persisted (ADR M-004 / M-001's threat model — a
 * lost/stolen device should not yield a live access token from disk). It is a plain module-level
 * variable with a tiny subscriber list so React code (`AuthProvider`) can re-render when it
 * changes, while non-React code (the API transport, the auth client's refresh guard) can read and
 * write it synchronously without going through React at all.
 */

type Listener = () => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener());
}

export function subscribeAccessToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only escape hatch so each test starts from a clean slate. */
export function __resetTokenStoreForTests(): void {
  accessToken = null;
  listeners.clear();
}
