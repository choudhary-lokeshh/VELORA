import { formatMinorUnits } from '@velora/validation/money-bounds';

import type { Tone } from '../design/primitives';

/**
 * Turning the money contract into what a person reads, on a phone.
 *
 * The same translations Consumer Web makes, kept here rather than shared,
 * because `packages/design-tokens` is the only thing the two surfaces share and
 * an application may not read another application's source. What is shared is
 * the wording, and it is shared by being written the same — a state that reads
 * one way on a laptop and another on a phone is the same product telling
 * somebody two things.
 *
 * Nothing here softens a state. `past_due` says access has stopped, because it
 * has: whether a lapsed payment keeps access is grace policy nobody approved,
 * and the fail-closed reading of an unresolved policy is no access.
 */

export interface StateLook {
  readonly label: string;
  readonly tone: Tone;
}

const fallback: StateLook = { label: 'Unknown', tone: 'neutral' };

/** An amount with its currency, rendered exactly, never re-derived. */
export function formatPrice(amount: {
  readonly amountMinor: string;
  readonly currency: string;
}): string {
  return `${formatMinorUnits(amount.amountMinor, amount.currency)} ${amount.currency}`;
}

/** How often a price recurs, said the way somebody would say it. */
export const cadenceLabels: Readonly<Record<string, string>> = {
  month: 'a month',
  year: 'a year',
};

const subscriptionState: Readonly<Record<string, StateLook>> = {
  active: { label: 'Active', tone: 'positive' },
  cancel_at_period_end: { label: 'Ends when the period does', tone: 'caution' },
  cancelled: { label: 'Ended', tone: 'neutral' },
  past_due: { label: 'Payment lapsed', tone: 'critical' },
  pending: { label: 'Starting', tone: 'accent' },
  terminated: { label: 'Ended', tone: 'neutral' },
};

export function subscriptionStateLook(state: string): StateLook {
  return subscriptionState[state] ?? fallback;
}

export const subscriptionStateMeaning: Readonly<Record<string, string>> = {
  active: 'It renews on its own until you stop it.',
  cancel_at_period_end:
    'It will not renew. You keep everything it gives you until the paid period ends.',
  cancelled: 'It has ended and nothing more will be charged.',
  past_due:
    'A renewal did not go through, so access has stopped. VELORA has no grace period, because none has been decided.',
  pending:
    'The payment has not settled yet. Nothing is unlocked until it does.',
  terminated: 'It has ended and nothing more will be charged.',
};

const paymentState: Readonly<Record<string, StateLook>> = {
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  created: { label: 'Starting', tone: 'accent' },
  failed: { label: 'Did not go through', tone: 'critical' },
  provider_pending: { label: 'Waiting on payment', tone: 'accent' },
  reconciliation_pending: { label: 'Being confirmed', tone: 'caution' },
  requires_action: { label: 'Needs finishing', tone: 'caution' },
  succeeded: { label: 'Paid', tone: 'positive' },
};

export function paymentStateLook(state: string): StateLook {
  return paymentState[state] ?? fallback;
}

/** Where a membership came from, in words rather than the wire vocabulary. */
export const membershipSourceLabels: Readonly<Record<string, string>> = {
  admin_grant: 'Granted by VELORA',
  billing: 'Paid membership',
  creator_invite: 'Invitation from the creator',
};
