import * as SecureStore from 'expo-secure-store';

/**
 * Token storage boundary for Consumer Mobile.
 *
 * ADR-0017 requires refresh material to live in iOS Keychain-backed and Android
 * Keystore-backed storage, to be excluded from device backups where the
 * platform supports it, and never to reach ordinary asynchronous storage or a
 * log. `expo-secure-store` is the first-party Expo module for exactly that; it
 * is the only implementation that claims those properties. The in-memory
 * implementation below is for tests and says so in its name, so no test can
 * accidentally be read as evidence about the platform keystore.
 */

export interface SecureTokenStore {
  clear(): Promise<void>;
  readonly kind: string;
  read(): Promise<StoredMobileTokens | undefined>;
  write(tokens: StoredMobileTokens): Promise<void>;
}

export interface StoredMobileTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly installationId: string;
  readonly refreshToken: string;
}

const storageKey = 'velora.auth.consumer_mobile';

function parse(raw: string | null): StoredMobileTokens | undefined {
  if (raw === null) return undefined;
  try {
    const decoded: unknown = JSON.parse(raw);
    if (typeof decoded !== 'object' || decoded === null) return undefined;
    const { accessToken, accessTokenExpiresAt, installationId, refreshToken } =
      decoded as Record<string, unknown>;
    if (
      typeof accessToken !== 'string' ||
      typeof accessTokenExpiresAt !== 'string' ||
      typeof installationId !== 'string' ||
      typeof refreshToken !== 'string'
    ) {
      return undefined;
    }
    return { accessToken, accessTokenExpiresAt, installationId, refreshToken };
  } catch {
    return undefined;
  }
}

/**
 * Platform keystore adapter. Every failure is answered as "no stored session"
 * rather than by throwing into the auth state machine, because a device that
 * cannot open its keystore must re-authenticate, not crash.
 */
export function createPlatformSecureTokenStore(): SecureTokenStore {
  return {
    kind: 'expo-secure-store',
    async clear() {
      try {
        await SecureStore.deleteItemAsync(storageKey);
      } catch {
        // Nothing to report: the caller's intent is that no token remains
        // usable, and the tokens are revoked server-side regardless.
      }
    },
    async read() {
      try {
        return parse(await SecureStore.getItemAsync(storageKey));
      } catch {
        return undefined;
      }
    },
    async write(tokens) {
      await SecureStore.setItemAsync(storageKey, JSON.stringify(tokens), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
  };
}

/**
 * Test double. It provides no confidentiality and claims none; it exists so the
 * refresh and restore logic can be tested without asserting anything about a
 * platform keystore.
 */
export function createInMemorySecureTokenStore(options?: {
  readonly failWrites?: boolean;
}): SecureTokenStore {
  let held: StoredMobileTokens | undefined;
  return {
    kind: 'in-memory-test-double',
    clear() {
      held = undefined;
      return Promise.resolve();
    },
    read() {
      return Promise.resolve(held);
    },
    write(tokens) {
      if (options?.failWrites === true) {
        return Promise.reject(new Error('secure storage unavailable'));
      }
      held = tokens;
      return Promise.resolve();
    },
  };
}
