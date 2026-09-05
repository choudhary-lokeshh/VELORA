import * as SecureStore from 'expo-secure-store';

import type { Acquisition } from '@velora/consumer-client';

/**
 * The invitation this device arrived with, held until an account exists.
 *
 * Same rule as Consumer Web's: **first touch, and only until signup**. The
 * first invitation this device opened is the one kept, a later one does not
 * replace it, and nothing is remembered once the account it belongs to has been
 * created. Written down in both places because the alternative — last touch —
 * rewards whoever got somebody to tap most recently rather than whoever
 * actually introduced them, and this product has no advertising to reward.
 *
 * It is in the platform keystore rather than in ordinary storage, and that is a
 * convenience rather than a security claim: the keystore is the only storage
 * this application already depends on, and adding a second storage module to
 * hold twenty-two characters would be a dependency for nothing. Nothing here is
 * a credential — the code authorises nothing, and a device that loses it loses
 * an attribution and no access.
 *
 * Every call is wrapped. A device whose keystore cannot be opened has to be
 * able to sign up; the honest consequence is that the signup is attributed to
 * nobody.
 */

const storageKey = 'velora.growth.invitation';

const codePattern = /^[a-z0-9]{22}$/u;

/** Remembers an invitation code, unless this device already holds one. */
export async function rememberInvitation(code: string): Promise<void> {
  if (!codePattern.test(code)) return;
  try {
    // First touch. Read before write rather than write-and-hope: the second
    // invitation somebody opens must not take credit from the first.
    const existing = await SecureStore.getItemAsync(storageKey);
    if (existing !== null) return;
    await SecureStore.setItemAsync(storageKey, code);
  } catch {
    // No keystore. This arrival is attributed to nobody, which is a worse
    // number and not a worse outcome for the person.
  }
}

/** What to offer the server when an account is created, if anything. */
export async function heldAcquisition(): Promise<Acquisition | undefined> {
  try {
    const code = await SecureStore.getItemAsync(storageKey);
    return code !== null && codePattern.test(code)
      ? { inviteCode: code }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Forgets the invitation, once it can no longer be used.
 *
 * Called after the account exists, whatever the answer was. Keeping it would
 * leave a device carrying somebody else's code indefinitely, and the server
 * would refuse to act on it anyway: an account has exactly one origin, recorded
 * at the moment it was created.
 */
export async function forgetInvitation(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKey);
  } catch {
    // Nothing to do and nothing worth reporting.
  }
}
