import type {
  Availability,
  ConsumerAccount,
  ConsumerProfile,
  OnboardingState,
} from './contract.js';
import type { ApiResult } from './result.js';

/**
 * What the product is currently asking of the person, derived from server
 * state alone.
 *
 * Pure on purpose. Every value here comes from a response the server produced;
 * nothing is remembered across a reload, guessed from a previous answer, or
 * decided by the client. That is what makes the surface safe to revalidate at
 * any moment — a second opinion from the server simply replaces the first — and
 * it is what makes these rules testable without a browser.
 *
 * The admission ladder itself is the server's: `outstandingProfile`,
 * `outstandingPolicies`, and `step` are computed from stored evidence and this
 * module only renders them. A client that re-derived the ladder would
 * eventually disagree with the server about who may be seen.
 */

export type JourneyStage =
  /** Signed in to AUTH, but no consumer account exists yet. */
  | 'account_required'
  | 'adult_declaration'
  | 'policy_acknowledgement'
  | 'profile'
  /** Admitted: discovery, introductions, and messaging are reachable. */
  | 'ready';

export const journeyStageLabels: Readonly<Record<JourneyStage, string>> = {
  account_required: 'Create your account',
  adult_declaration: 'Confirm you are an adult',
  policy_acknowledgement: 'Accept the policies',
  profile: 'Complete your profile',
  ready: 'Ready',
};

export function journeyStage(
  onboarding: OnboardingState | undefined,
): JourneyStage {
  if (onboarding === undefined) return 'account_required';
  switch (onboarding.step) {
    case 'adult_declaration': {
      return 'adult_declaration';
    }
    case 'policy_acknowledgement': {
      return 'policy_acknowledgement';
    }
    case 'profile': {
      return 'profile';
    }
    default: {
      return 'ready';
    }
  }
}

/**
 * How a profile's images stand.
 *
 * `rejected` is reported because the person can act on it — replace the image —
 * and because silently showing "incomplete" for a rejected upload would leave
 * somebody re-reading a form that was never the problem. Nothing here claims
 * the image was scanned or moderated: no such capability exists, and the
 * rejection reasons the server publishes are structural.
 */
export type ProfileMediaState =
  'none' | 'pending' | 'checking' | 'preparing' | 'rejected' | 'ready';

/**
 * The strongest thing true of any of somebody's images.
 *
 * Ordered by how far along it is rather than by how recent, because a person
 * with one ready image and one still being checked has a usable profile and
 * should be told so. A rejection outranks work in progress for the opposite
 * reason: it is the only state that needs them to do something.
 */
export function profileMediaState(
  profile: ConsumerProfile | undefined,
): ProfileMediaState {
  if (profile === undefined || profile.media.length === 0) return 'none';
  const has = (state: string) =>
    profile.media.some((item) => item.state === state);
  if (has('ready')) return 'ready';
  if (has('rejected')) return 'rejected';
  if (has('preparing')) return 'preparing';
  if (has('checking')) return 'checking';
  if (has('pending_upload')) return 'pending';
  return 'none';
}

/**
 * What each state says, in words that are true.
 *
 * `checking` and `preparing` are separate because they take separate amounts of
 * time and because "still working" for the whole of both would tell somebody
 * nothing for the entire period anything is happening. Neither claims the image
 * was moderated: no such capability exists, and the refusals the server
 * publishes are structural.
 */
export const profileMediaLabels: Readonly<Record<ProfileMediaState, string>> = {
  checking: 'Checking the photo…',
  none: 'No image yet',
  pending: 'Upload started, not yet confirmed',
  preparing: 'Preparing the photo…',
  ready: 'Image ready',
  rejected: 'Image was not accepted. Upload another.',
};

/**
 * Availability as the person should see it.
 *
 * `expired` is distinct from `unavailable` and that distinction is the point.
 * The server already reports `effectiveState` as `unavailable` once a window
 * closes, so nothing acts on a stale window — but a surface that showed only
 * "unavailable" would hide that the person had chosen otherwise and simply ran
 * out of time. Nothing here is presence: an availability is a bounded choice,
 * not a claim that somebody is at their screen.
 */
export type AvailabilityView = 'unavailable' | 'available' | 'expired';

export function availabilityView(
  availability: Availability | undefined,
): AvailabilityView {
  if (availability === undefined) return 'unavailable';
  if (availability.effectiveState === 'available') return 'available';
  return availability.state === 'available' ? 'expired' : 'unavailable';
}

export const availabilityLabels: Readonly<Record<AvailabilityView, string>> = {
  available: 'Available',
  expired: 'Availability window ended',
  unavailable: 'Not available',
};

/**
 * The account's own standing, as its owner may see it.
 *
 * `restricted` is shown to the person it describes and to nobody else. The
 * coarse reason the server publishes is repeated verbatim rather than expanded:
 * enforcement detail is a moderation fact, and inventing an explanation here
 * would be inventing policy.
 */
export type AccountStanding =
  'active' | 'pending_profile' | 'restricted' | 'closed';

export function accountStanding(account: ConsumerAccount): AccountStanding {
  switch (account.status) {
    case 'active': {
      return 'active';
    }
    case 'pending_profile': {
      return 'pending_profile';
    }
    case 'restricted': {
      return 'restricted';
    }
    default: {
      return 'closed';
    }
  }
}

export const accountStandingLabels: Readonly<Record<AccountStanding, string>> =
  {
    active: 'Account active',
    closed: 'This account is closed',
    pending_profile: 'Account created, profile not finished',
    restricted: 'This account is restricted',
  };

/**
 * What to tell somebody about a call that did not succeed.
 *
 * One sentence per branch, none of which describes another person. A refusal
 * that could have been caused by a block reads as a refusal, because the API
 * deliberately does not say which — and a client that guessed would be creating
 * the disclosure the server withheld.
 */
export function failureMessage(result: ApiResult<unknown>): string | undefined {
  switch (result.kind) {
    case 'ok': {
      return undefined;
    }
    case 'unauthenticated': {
      return 'Your session ended. Sign in again.';
    }
    case 'not-found': {
      return 'That is no longer available.';
    }
    case 'unavailable': {
      return 'VELORA could not be reached. Try again.';
    }
    default: {
      return refusalMessages[result.code] ?? 'That is not possible right now.';
    }
  }
}

/**
 * Product codes worth a specific sentence.
 *
 * Everything absent from this map falls back to one honest generic sentence.
 * That is deliberate: a code the client does not recognise must not be shown
 * raw, and must not be paraphrased into a claim the server never made.
 */
const refusalMessages: Readonly<Record<string, string>> = {
  ACCOUNT_NOT_ELIGIBLE: 'Your account cannot do that in its current state.',
  ACTION_NOT_PERMITTED: 'That is not possible right now.',
  CONSUMER_SURFACE_REQUIRED: 'Sign in again on this device.',
  DEPENDENCY_UNAVAILABLE:
    'That is not available in this environment yet. Nothing was lost.',
  IDEMPOTENCY_KEY_MISMATCH:
    'That message was already sent with different text.',
  LIMIT_REACHED: 'You have reached the limit for this.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  STATE_CONFLICT: 'Something changed while you were editing. Reload and retry.',
  VALIDATION_FAILED: 'Check the details and try again.',
};

/**
 * Whether a failed action is worth offering a retry for.
 *
 * A refusal is a decision and repeating it changes nothing; an unreachable
 * server is a condition and repeating it may. Offering "try again" on a refusal
 * would invite somebody to hammer a decision that has already been made.
 */
export function isRetryable(result: ApiResult<unknown>): boolean {
  return result.kind === 'unavailable';
}
