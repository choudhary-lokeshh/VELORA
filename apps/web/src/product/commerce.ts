import type { Tone } from '../design/primitives';
import { formatMinorUnits } from '@velora/validation';

/**
 * Turning the money contract into what a person reads.
 *
 * Every enum BILLING publishes is a word chosen for a state machine, and every
 * amount it publishes is an integer count of minor units. Neither belongs on a
 * screen unaltered. This is the one place either is translated, so a state that
 * gains a member is a missing key in a lookup here rather than a raw
 * `cancel_at_period_end` appearing in a sentence somebody reads.
 *
 * Nothing here softens anything. `past_due` says access has stopped, because it
 * has: whether a lapsed payment keeps access is grace policy nobody has
 * approved, and the fail-closed reading of an unresolved policy is no access. A
 * label that said "payment issue" and left it there would be the place that
 * quietly became a grace period.
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

/** The same cadence as a noun, for a heading rather than a sentence. */
export const cadenceNames: Readonly<Record<string, string>> = {
  month: 'Monthly',
  year: 'Yearly',
};

const subscriptionState: Readonly<Record<string, StateLook>> = {
  active: { label: 'Active', tone: 'positive' },
  cancel_at_period_end: { label: 'Ends when the period does', tone: 'caution' },
  cancelled: { label: 'Ended', tone: 'neutral' },
  past_due: { label: 'Payment lapsed — access has stopped', tone: 'critical' },
  pending: { label: 'Starting', tone: 'info' },
  terminated: { label: 'Ended', tone: 'neutral' },
};

export function subscriptionStateLook(state: string): StateLook {
  return subscriptionState[state] ?? fallback;
}

/**
 * What each subscription state actually means for the person holding it.
 *
 * Said in full rather than implied by a badge, because every one of these has a
 * consequence somebody would otherwise have to guess at — and because the
 * consequence of `past_due` is the one nobody expects.
 */
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
  created: { label: 'Starting', tone: 'info' },
  failed: { label: 'Did not go through', tone: 'critical' },
  provider_pending: { label: 'Waiting on payment', tone: 'info' },
  reconciliation_pending: { label: 'Being confirmed', tone: 'caution' },
  requires_action: { label: 'Needs you to finish it', tone: 'caution' },
  succeeded: { label: 'Paid', tone: 'positive' },
};

export function paymentStateLook(state: string): StateLook {
  return paymentState[state] ?? fallback;
}

export const paymentStateMeaning: Readonly<Record<string, string>> = {
  cancelled: 'You stopped it, and nothing was charged.',
  created: 'Nothing has been sent to a payment provider yet.',
  failed: 'The payment was refused. Nothing was charged and nothing unlocked.',
  provider_pending: 'Finish the payment on the page you were sent to.',
  reconciliation_pending:
    'The answer from the payment provider was lost, so VELORA does not know yet. It will resolve on its own and nothing is charged twice.',
  requires_action: 'The payment provider needs another step from you.',
  succeeded: 'The payment settled.',
};

export const paymentFailureLabels: Readonly<Record<string, string>> = {
  cancelled_by_consumer: 'You cancelled it.',
  declined: 'Your bank or card declined it.',
  expired: 'It was left too long and expired.',
  provider_error: 'The payment provider could not complete it.',
};

/**
 * Why VELORA cannot sell to this person, one shut gate at a time.
 *
 * Each is attributed to a decision nobody has taken rather than to anything the
 * reader did. Somebody refused a purchase is owed the reason, and the reason is
 * never that there is something wrong with them.
 */
export const commerceGateLabels: Readonly<Record<string, string>> = {
  consumer_country: 'VELORA has not been approved to sell in your country.',
  creator_country:
    'VELORA has not been approved to sell on behalf of creators in this creator’s country.',
  currency: 'No currency is approved for this pairing.',
  payment_capability: 'No payment provider is approved for what VELORA does.',
  payout_capability:
    'VELORA has no approved way to pay this creator, so it will not take money for them.',
  tax_authority:
    'Nothing can say what tax would be owed on this sale, so it cannot be made.',
};

/** Where a membership came from, in words rather than the wire vocabulary. */
export const membershipSourceLabels: Readonly<Record<string, string>> = {
  admin_grant: 'Granted by VELORA',
  billing: 'Paid membership',
  creator_invite: 'Invitation from the creator',
};
