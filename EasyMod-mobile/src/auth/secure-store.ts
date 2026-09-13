import * as SecureStore from 'expo-secure-store';

/**
 * The refresh token is the one long-lived credential on the device, so it goes in SecureStore
 * (Android Keystore-backed) rather than AsyncStorage/plain memory (ADR M-004).
 */
const REFRESH_TOKEN_KEY = 'easymod.auth.refreshToken';

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

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Already absent — nothing to do.
  }
}
