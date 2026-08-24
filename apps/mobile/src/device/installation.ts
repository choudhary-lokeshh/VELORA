import { getRandomBytes, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * What this installation of the application is called.
 *
 * Before this existed, every device in the world sent the literal string
 * `installation-local-device`. That is not a cosmetic defect. ADR-0009 and
 * ADR-0017 build per-device session revocation on this identifier, and the
 * notifications contract keys a push registration on it — "registering a token
 * another account holds retires that account's registration, because a device
 * can only be addressed for one person". With one shared value, signing out
 * everywhere, revoking one device, and replacing a push token were all
 * operations on a single imaginary device that every installation shared.
 *
 * The identifier is deliberately weak information. It is a random value with
 * nothing derived from the hardware: not the Android ID, not the advertising
 * identifier, not the build fingerprint. Those are cross-application
 * identifiers, they survive an uninstall, and none of them is needed to answer
 * the only question being asked, which is "is this the same installation that
 * registered before".
 *
 * It lives in the platform keystore beside the session, but it is not a secret
 * and nothing here treats it as one. It is stored there because that is the
 * only durable store this application has, and because it must survive signing
 * out — which clears the session — while not surviving an uninstall, which
 * Android guarantees by clearing keystore data with the application. A
 * reinstall is therefore a new installation, which is the correct answer: the
 * old registration is unreachable and the server retires it on its own terms.
 */

const storageKey = 'velora.device.installation';

/**
 * The shape both contracts accept.
 *
 * `packages/validation` bounds the auth identifier at 8–128 characters matching
 * `[A-Za-z0-9._-]`, and the push identifier at 8–256 with no character rule.
 * One value has to satisfy both, so it is built to the stricter of the two: a
 * platform word and a version 4 UUID, 44 characters of hyphens, digits, and
 * lower-case letters.
 */
const identifierPattern = /^android-[0-9a-f-]{36}$/u;

export interface InstallationIdentity {
  /**
   * This installation's identifier, creating one on first use.
   *
   * Concurrent callers share one creation: two screens asking at once during a
   * cold launch must not mint two identifiers and race to store them, because
   * the loser would be an installation the server had already been told about.
   */
  current(): Promise<string>;
}

export interface InstallationStore {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

/** The platform keystore, reached through the same module the session uses. */
export function createPlatformInstallationStore(): InstallationStore {
  return {
    async read() {
      try {
        return (await SecureStore.getItemAsync(storageKey)) ?? undefined;
      } catch {
        // A keystore that will not open is reported as "nothing stored". The
        // caller mints a new identifier, which costs one re-registration and
        // never a crash.
        return undefined;
      }
    },
    async write(value) {
      await SecureStore.setItemAsync(storageKey, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
  };
}

/**
 * A version 4 UUID, from whichever primitive the platform will actually give.
 *
 * `randomUUID` is a convenience over `getRandomBytes`, and a build where the
 * convenience is missing still has the primitive. Falling back rather than
 * throwing matters because the only caller is sign-in: an installation
 * identifier that cannot be minted would stop somebody signing in at all,
 * which is a far worse outcome than deriving the same value one layer down.
 * If neither works there is nothing left to try, and that does throw.
 */
function mintUuid(): string {
  const direct: unknown = randomUUID();
  if (typeof direct === 'string' && direct.length === 36) return direct;

  const bytes = getRandomBytes(16);
  if (bytes.length !== 16) {
    throw new Error('No source of randomness for an installation identifier');
  }
  // Version 4, variant 1, per RFC 9562.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function createInstallationIdentity(options: {
  readonly generate?: () => string;
  readonly store: InstallationStore;
}): InstallationIdentity {
  const generate = options.generate ?? (() => `android-${mintUuid()}`);
  let held: string | undefined;
  let inFlight: Promise<string> | undefined;

  const establish = async (): Promise<string> => {
    const stored = await options.store.read();
    // A stored value that does not match what the contracts accept is treated
    // as absent rather than sent. It could only have come from an older build
    // or a corrupted entry, and a request the server refuses at validation
    // would take the whole registration down with it.
    if (stored !== undefined && identifierPattern.test(stored)) {
      held = stored;
      return stored;
    }
    const minted = generate();
    if (!identifierPattern.test(minted)) {
      throw new Error('Generated installation identifier is not usable');
    }
    try {
      await options.store.write(minted);
    } catch {
      // Unwritable storage means this launch has an identifier and the next
      // one has a different identifier. That degrades per-device revocation to
      // per-launch; it does not break anything, and it is better than refusing
      // to run. The server retires the stale registration when its token stops
      // resolving.
    }
    held = minted;
    return minted;
  };

  return {
    async current() {
      if (held !== undefined) return held;
      inFlight ??= establish().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

/** Test double. It persists in memory and claims nothing about a keystore. */
export function createInMemoryInstallationStore(options?: {
  readonly failWrites?: boolean;
  readonly initial?: string;
}): InstallationStore {
  let held = options?.initial;
  return {
    read() {
      return Promise.resolve(held);
    },
    write(value) {
      if (options?.failWrites === true) {
        return Promise.reject(new Error('installation storage unavailable'));
      }
      held = value;
      return Promise.resolve();
    },
  };
}
