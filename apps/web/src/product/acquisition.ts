'use client';

import type { Acquisition } from '@velora/consumer-client';

/**
 * Where this visitor came from, remembered until they have an account.
 *
 * The rule is **first touch, and only until signup**. The first arrival that
 * carried an invitation or a campaign is the one kept; a later link does not
 * overwrite it, and nothing is remembered after the account exists. That is one
 * choice out of several defensible ones and it is written down here because the
 * alternative — last touch — quietly rewards whoever got the person to click
 * most recently rather than whoever actually introduced them, and this product
 * has no advertising to reward.
 *
 * Everything here is per-browser and stays in the browser. It is not sent
 * anywhere until the moment an account is created, it is deleted as soon as one
 * is, and it holds nothing about the person: an invitation code, up to four
 * campaign labels somebody put in a link, and a random key used to stop a page
 * refresh counting twice.
 *
 * Every read and write is wrapped. A private window, cleared site data, and a
 * browser configured to refuse storage all throw on access rather than
 * returning nothing, and none of them is a reason for a page to fail to render
 * — the honest consequence is that this visit is attributed to nobody.
 */

const storageKey = 'velora.acquisition';
const openingKeyStorageKey = 'velora.invitation-opening-key';

/**
 * The longest value carried out of an address bar.
 *
 * Bounded here rather than at the server, so a link with a megabyte of query
 * string produces a truncated label instead of a refused signup. The server
 * bounds it again and normalises what survives; this is what stops a hostile
 * address ever becoming somebody's failed account creation.
 */
const maximumParameterLength = 200;

const openingKeyAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const openingKeyLength = 22;

interface StoredAcquisition {
  readonly campaign?: string;
  readonly content?: string;
  readonly inviteCode?: string;
  readonly medium?: string;
  readonly source?: string;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readStored(): StoredAcquisition | undefined {
  try {
    const raw = storage()?.getItem(storageKey);
    if (raw === null || raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    // Read field by field rather than trusted whole. What is in storage was
    // written by an older version of this file, or by somebody with a console
    // open, and anything that is not a string is simply not there.
    const text = (key: string): string | undefined =>
      typeof record[key] === 'string' ? record[key] : undefined;
    const campaign = text('campaign');
    const content = text('content');
    const inviteCode = inviteCodeOf(text('inviteCode'));
    const medium = text('medium');
    const source = text('source');
    const value: StoredAcquisition = {
      ...(campaign === undefined ? {} : { campaign }),
      ...(content === undefined ? {} : { content }),
      ...(inviteCode === undefined ? {} : { inviteCode }),
      ...(medium === undefined ? {} : { medium }),
      ...(source === undefined ? {} : { source }),
    };
    return Object.keys(value).length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function writeStored(value: StoredAcquisition): void {
  try {
    storage()?.setItem(storageKey, JSON.stringify(value));
  } catch {
    // A browser that refuses storage attributes this visit to nobody, which is
    // a worse answer than the truth and a much better one than a broken page.
  }
}

/** One campaign field, bounded and emptied of anything that is only whitespace. */
function bounded(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim().slice(0, maximumParameterLength);
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The shape the server will accept, which is the only shape worth keeping. */
function inviteCodeOf(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && /^[a-z0-9]{22}$/u.test(value)
    ? value
    : undefined;
}

/**
 * Records where this visit came from, if it is the first that said.
 *
 * Called on every public page rather than only on the invitation one, because
 * a campaign parameter can be on any address somebody shares — a creator's
 * page, an explanation, the entry. It writes nothing when there is nothing to
 * write, and it never replaces what is already there.
 */
export function captureAcquisition(input: {
  readonly inviteCode?: string | undefined;
  readonly search: string;
}): void {
  const parameters = new URLSearchParams(input.search);
  const campaign = bounded(parameters.get('utm_campaign'));
  const content = bounded(parameters.get('utm_content'));
  const medium = bounded(parameters.get('utm_medium'));
  const source = bounded(parameters.get('utm_source'));
  const inviteCode = inviteCodeOf(
    input.inviteCode ?? parameters.get('ref') ?? undefined,
  );
  const captured: StoredAcquisition = {
    ...(campaign === undefined ? {} : { campaign }),
    ...(content === undefined ? {} : { content }),
    ...(inviteCode === undefined ? {} : { inviteCode }),
    ...(medium === undefined ? {} : { medium }),
    ...(source === undefined ? {} : { source }),
  };
  if (Object.keys(captured).length === 0) return;
  // First touch. A person who opened an invitation last week and a campaign
  // link today was introduced by the invitation, and the second link does not
  // get to take the credit.
  if (readStored() !== undefined) return;
  writeStored(captured);
}

/** What to offer the server when an account is created, if anything. */
export function storedAcquisition(): Acquisition | undefined {
  const stored = readStored();
  if (stored === undefined) return undefined;
  const value: Acquisition = {
    ...(stored.campaign === undefined ? {} : { campaign: stored.campaign }),
    ...(stored.content === undefined ? {} : { content: stored.content }),
    ...(stored.inviteCode === undefined
      ? {}
      : { inviteCode: stored.inviteCode }),
    ...(stored.medium === undefined ? {} : { medium: stored.medium }),
    ...(stored.source === undefined ? {} : { source: stored.source }),
  };
  return Object.keys(value).length === 0 ? undefined : value;
}

/**
 * Forgets where somebody came from, once it can no longer be used.
 *
 * Called after the account exists. Keeping it would mean a browser carrying a
 * stranger's invitation code indefinitely for no purpose, and the server would
 * refuse to act on it anyway — an account has exactly one origin, recorded at
 * the moment it was created.
 */
export function clearAcquisition(): void {
  try {
    storage()?.removeItem(storageKey);
  } catch {
    // Nothing to do and nothing worth reporting.
  }
}

/**
 * This browser's key for counting invitation openings.
 *
 * Generated once and kept, so somebody refreshing an invitation page ten times
 * is one opening rather than ten. It identifies nobody: it is never sent with
 * anything else, is never joined to an account, and is worth nothing to
 * anybody who reads it. A browser that refuses storage gets a fresh one each
 * time, which counts a refresh twice — a worse number, and not a worse
 * outcome for the person.
 */
export function invitationOpeningKey(): string {
  try {
    const existing = storage()?.getItem(openingKeyStorageKey);
    if (existing !== null && existing !== undefined) {
      if (/^[a-z0-9]{22}$/u.test(existing)) return existing;
    }
  } catch {
    // Fall through and mint one for this visit only.
  }
  const minted = mintOpeningKey();
  try {
    storage()?.setItem(openingKeyStorageKey, minted);
  } catch {
    // Kept for this page only.
  }
  return minted;
}

function mintOpeningKey(): string {
  const bytes = new Uint8Array(openingKeyLength);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    // No platform random source, which is a real runtime rather than a
    // hypothetical one. The key is a deduplication hint rather than a secret,
    // so a weaker one costs an accurate count and nothing else.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let key = '';
  for (const byte of bytes) {
    key += openingKeyAlphabet.charAt(byte % openingKeyAlphabet.length);
  }
  return key;
}
