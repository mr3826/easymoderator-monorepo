import * as SecureStore from 'expo-secure-store';

/**
 * The refresh token is the one long-lived credential on the device, so it goes in SecureStore
 * (Android Keystore-backed) rather than AsyncStorage/plain memory (ADR M-004).
 */
const REFRESH_TOKEN_KEY = 'easymod.auth.refreshToken';

/**
 * Who the stored refresh token belongs to (the backend's safe user fields plus the session shop).
 * Kept beside the refresh token, with the same protection, so an offline cold start can show that
 * user's persisted read-only Home (ADR M-011) without a network round trip. It never outlives the
 * refresh token: every path that clears the token clears this too.
 */
const SESSION_IDENTITY_KEY = 'easymod.auth.sessionIdentity';

export interface StoredSessionIdentity {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  profile_picture: string | null;
  shopId: string | null;
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // A corrupt keystore entry or an unsupported device should degrade to "not logged in",
    // never crash the app on startup.
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

/** Removes the stored session: the refresh token and the identity that belongs to it. */
export async function clearRefreshToken(): Promise<void> {
  for (const key of [REFRESH_TOKEN_KEY, SESSION_IDENTITY_KEY]) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Already absent — nothing to do.
    }
  }
}

export async function setSessionIdentity(identity: StoredSessionIdentity): Promise<void> {
  await SecureStore.setItemAsync(SESSION_IDENTITY_KEY, JSON.stringify(identity));
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

export async function getSessionIdentity(): Promise<StoredSessionIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.id !== 'string' ||
      typeof value.email !== 'string' ||
      !nullableString(value.full_name) ||
      !nullableString(value.phone) ||
      !nullableString(value.profile_picture) ||
      !nullableString(value.shopId)
    ) {
      return null;
    }
    return {
      id: value.id,
      email: value.email,
      full_name: value.full_name,
      phone: value.phone,
      profile_picture: value.profile_picture,
      shopId: value.shopId,
    };
  } catch {
    // Unreadable or corrupt: behave as if there is no offline identity.
    return null;
  }
}
