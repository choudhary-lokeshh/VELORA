import type { Tone } from '../design/primitives';
import type { IconName } from '../design/icons';

/**
 * Turning what the contract carries into what a creator reads.
 *
 * Every enum the API publishes is a word chosen for a state machine, and every
 * timestamp it publishes is an ISO instant. Neither belongs on a screen. This
 * module is the one place either is translated, so a state that gains a member
 * is a compile error in a lookup rather than a raw `recipient_not_ready`
 * appearing in a sentence.
 *
 * Nothing here invents meaning. Each label restates exactly what the server
 * said, in the creator's terms, and where the platform deliberately does not
 * explain something — an enforcement reason, for instance — the label stays
 * coarse rather than filling the gap with a guess.
 *
 * Every one of these runs in the browser only. The screens that use them sit
 * behind a gate that renders a placeholder until the session answer arrives, so
 * a locale-formatted date is never produced during a server render and then
 * produced differently during hydration.
 */

/* ================================ Dates ============================== */

/** A date, in the reader's own locale, without a time nobody needs. */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** A date and a time, without the seconds nobody needs. */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * How long is left, said the way somebody would say it.
 *
 * Coarse on purpose, and honest about having run out. An invitation that says
 * "expires in 3 days" is actionable; one that says "expires 2026-09-01T09:14:22Z"
 * is a timestamp somebody has to do arithmetic on.
 */
export function formatRemaining(
  value: string,
  now: number = Date.now(),
): string {
  const remaining = new Date(value).getTime() - now;
  if (Number.isNaN(remaining)) return 'Expiry unknown';
  if (remaining <= 0) return 'Expired';
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) {
    return `Expires in ${String(Math.max(1, minutes))} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Expires in ${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.floor(hours / 24);
  return `Expires in ${String(days)} ${days === 1 ? 'day' : 'days'}`;
}

export function hasExpired(value: string, now: number = Date.now()): boolean {
  const at = new Date(value).getTime();
  return !Number.isNaN(at) && at <= now;
}

/* ============================ Presentation =========================== */

export interface StateLook {
  readonly icon: IconName;
  readonly label: string;
  readonly tone: Tone;
}

/**
 * A state's colour, its mark, and its words — never fewer than all three.
 *
 * `docs/design/05-accessibility-motion.md` forbids colour as the only carrier
 * of status, so these are declared together rather than left to each screen to
 * pair up.
 */
const fallbackLook: StateLook = {
  icon: 'info',
  label: 'Unknown',
  tone: 'neutral',
};

function look(
  table: Readonly<Record<string, StateLook>>,
  key: string,
): StateLook {
  return table[key] ?? { ...fallbackLook, label: fallbackLook.label };
}

/* ------------------------------------------------------------ content */

const contentLifecycle: Readonly<Record<string, StateLook>> = {
  archived: { icon: 'archive', label: 'Archived', tone: 'neutral' },
  draft: { icon: 'draft', label: 'Draft', tone: 'caution' },
  published: { icon: 'globe', label: 'Published', tone: 'positive' },
};

export function contentLifecycleLook(lifecycle: string): StateLook {
  return look(contentLifecycle, lifecycle);
}

/** What each lifecycle position actually means for who can see the item. */
export const contentLifecycleMeaning: Readonly<Record<string, string>> = {
  archived: 'Withdrawn from your page, and still yours.',
  draft: 'Only you can see this.',
  published: 'Anyone who opens your page can see this.',
};

const contentVisibility: Readonly<Record<string, StateLook>> = {
  members_only: { icon: 'lock', label: 'Members only', tone: 'accent' },
  public: { icon: 'globe', label: 'Everyone', tone: 'neutral' },
};

export function contentVisibilityLook(visibility: string): StateLook {
  return look(contentVisibility, visibility);
}

/* -------------------------------------------------------------- clubs */

const clubLifecycle: Readonly<Record<string, StateLook>> = {
  closed: { icon: 'lock', label: 'Closed', tone: 'neutral' },
  draft: { icon: 'draft', label: 'Draft', tone: 'caution' },
  published: { icon: 'globe', label: 'Published', tone: 'positive' },
};

export function clubLifecycleLook(lifecycle: string): StateLook {
  return look(clubLifecycle, lifecycle);
}

export const clubLifecycleMeaning: Readonly<Record<string, string>> = {
  closed: 'Nobody can be admitted, and this cannot be undone.',
  draft: 'Nobody can see this or be admitted to it.',
  published: 'Listed on your public page. You decide who gets in.',
};

/**
 * Where a member's access came from, never a claim that money moved.
 *
 * `billing` is in the contract and cannot occur today, because no payment path
 * exists. It is translated anyway rather than left to fall through to a raw
 * enum on the day one does.
 */
export const membershipSourceLabels: Readonly<Record<string, string>> = {
  admin_grant: 'Admitted by VELORA',
  billing: 'Admitted by a purchase',
  creator_invite: 'Admitted by your invitation',
};

/* ------------------------------------------------------------ account */

const creatorStanding: Readonly<Record<string, StateLook>> = {
  active: { icon: 'check', label: 'Active', tone: 'positive' },
  applicant: { icon: 'clock', label: 'Not finished', tone: 'caution' },
  closed: { icon: 'lock', label: 'Closed', tone: 'neutral' },
  suspended: { icon: 'alert', label: 'Suspended', tone: 'critical' },
};

export function creatorStandingLook(status: string): StateLook {
  return look(creatorStanding, status);
}

/**
 * Why creator access is where it is, as its holder may be told.
 *
 * The coarse reason the server publishes is restated rather than expanded.
 * Enforcement detail is a Trust & Safety fact and inventing an explanation here
 * would be inventing policy — so a suspended creator is told that a decision
 * was made and where to ask about it, not what the decision was based on.
 */
export const standingReasonLabels: Readonly<Record<string, string>> = {
  creator_requested: 'You asked us to close your creator access.',
  eligibility_failed:
    'Your VELORA account does not currently meet what creator access requires.',
  onboarding_incomplete: 'There are still steps to finish before you can work.',
  platform_action: 'VELORA has restricted this creator account.',
  safety_enforcement:
    'This creator account is restricted following a safety decision.',
};

/** The creator policies, by the name they are published under. */
export const policyDocumentLabels: Readonly<Record<string, string>> = {
  creator_content_policy: 'Creator content policy',
  creator_terms: 'Creator terms',
};

/* -------------------------------------------------------------- money */

/**
 * A payout's position, said as a creator would ask about it.
 *
 * "Paid" is used for exactly one server state and never as a summary of any
 * other, because a creator reading "paid" will go and look at their bank.
 */
const payoutState: Readonly<Record<string, StateLook>> = {
  cancelled: { icon: 'x', label: 'Cancelled', tone: 'neutral' },
  failed: { icon: 'alert', label: 'Did not go through', tone: 'critical' },
  paid: { icon: 'check', label: 'Paid', tone: 'positive' },
  requested: { icon: 'clock', label: 'Requested', tone: 'caution' },
  reserved: { icon: 'clock', label: 'Being prepared', tone: 'caution' },
  reversed: { icon: 'alert', label: 'Reversed', tone: 'critical' },
  submitted: { icon: 'clock', label: 'Sent to your provider', tone: 'info' },
};

export function payoutStateLook(state: string): StateLook {
  return look(payoutState, state);
}

export const payoutFailureLabels: Readonly<Record<string, string>> = {
  declined: 'Your payout provider declined it.',
  provider_error: 'Your payout provider could not complete it.',
  recipient_not_ready: 'Your payout details were not ready.',
};

/** One commercial event, described without naming who was on the other side. */
export const earningsKindLabels: Readonly<Record<string, string>> = {
  capture: 'Purchase',
  dispute: 'Claim from a member',
  refund: 'Refund',
};

const offerState: Readonly<Record<string, StateLook>> = {
  active: { icon: 'check', label: 'On sale', tone: 'positive' },
  draft: { icon: 'draft', label: 'Draft', tone: 'caution' },
  retired: { icon: 'archive', label: 'Withdrawn', tone: 'neutral' },
};

export function offerStateLook(state: string): StateLook {
  return look(offerState, state);
}

export const offerModeLabels: Readonly<Record<string, string>> = {
  one_time: 'One-off purchase',
  subscription: 'Subscription',
};

export const priceIntervalLabels: Readonly<Record<string, string>> = {
  month: 'a month',
  year: 'a year',
};

/* ------------------------------------------------------------- safety */

/**
 * Each mature-content blocker in plain words, and each attributed to somebody
 * other than the creator reading it.
 */
export const matureBlockerLabels: Readonly<Record<string, string>> = {
  consent_wording_unpublished:
    'Nobody has approved the wording a depicted person would agree to.',
  content_taxonomy_undecided:
    'The content categories in use are provisional rather than approved.',
  depicted_person_verifier_unavailable:
    'No approved provider can verify a depicted adult.',
  mature_content_capability_disabled:
    'The capability itself is switched off and has no setting that turns it on.',
};

/* ============================== Counting ============================= */

/** A count and the thing it counted, agreeing in number. */
export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
