import type { ApiResult } from '@velora/api-client';

import type {
  CreatorAccount,
  CreatorOnboardingState,
  CreatorProfile,
} from './contract.js';

/**
 * What Creator Studio is currently asking of the creator, derived from server
 * state alone.
 *
 * Pure on purpose. Every value here comes from a response the server produced;
 * nothing is remembered across a reload, guessed from a previous answer, or
 * decided by the client. The admission ladder itself is the server's — a client
 * that re-derived it would eventually disagree with the server about who may
 * operate.
 */

export type CreatorStage =
  /** Signed in to AUTH, but no creator capability exists yet. */
  | 'capability_required'
  /** The platform's adult authority does not currently say yes. */
  | 'adult_eligibility'
  | 'policy_acknowledgement'
  /** Active, with no public identity yet. */
  | 'profile'
  /** Active with a profile. Publishing is still a separate decision. */
  | 'ready';

export const creatorStageLabels: Readonly<Record<CreatorStage, string>> = {
  adult_eligibility: 'Finish adult eligibility on VELORA',
  capability_required: 'Become a creator',
  policy_acknowledgement: 'Accept the creator policies',
  profile: 'Create your public profile',
  ready: 'Ready',
};

export function creatorStage(input: {
  readonly onboarding: CreatorOnboardingState | undefined;
  readonly profile: CreatorProfile | undefined;
}): CreatorStage {
  if (input.onboarding === undefined) return 'capability_required';
  switch (input.onboarding.step) {
    case 'adult_eligibility': {
      return 'adult_eligibility';
    }
    case 'policy_acknowledgement': {
      return 'policy_acknowledgement';
    }
    default: {
      return input.profile === undefined ? 'profile' : 'ready';
    }
  }
}

/**
 * Why the adult gate is unmet, in a sentence the creator can act on.
 *
 * Each one names the next step on a surface that can actually take it. Creator
 * Studio cannot declare somebody an adult — that is a consumer decision USERS
 * owns — so the honest instruction is where to go, not a control that would
 * fail here.
 */
export const creatorAdultGateMessages: Readonly<Record<string, string>> = {
  adult_declaration_missing:
    'Confirm on VELORA that you are an adult, then come back.',
  no_consumer_account: 'Create your VELORA account first, then come back.',
  not_in_good_standing:
    'Your VELORA account cannot hold creator access in its current state.',
};

/**
 * The same instruction before a capability exists, where no reason is published.
 *
 * `POST /v1/creator` refuses with one code for every unmet gate and deliberately
 * names none of them: the reason belongs to the onboarding state, which only
 * exists once a capability does. So this sentence covers the union of the three
 * above without asserting which applies — it points at the surface that can
 * answer instead of at the condition, which is the one honest thing to say when
 * the server has said only that the account is not eligible.
 *
 * It must not narrow to the adult declaration. Standing is the first gate the
 * server checks, precisely so a restricted account is never told that declaring
 * adulthood is what is missing; a client that guessed the declaration here would
 * reintroduce exactly that.
 */
export const creatorAdultGateUnnamedMessage =
  'Creator access sits on a VELORA account that is set up and in good standing. Finish your account on VELORA, then come back.';

/**
 * The sentence for a gate reason, whether or not the server named one.
 *
 * One function rather than a table plus a fallback written at each call site,
 * because the two screens that need it — before a capability exists and after —
 * are the same screen and must not drift into saying different things.
 */
export function creatorAdultGateMessage(reason?: string): string {
  if (reason === undefined) return creatorAdultGateUnnamedMessage;
  return creatorAdultGateMessages[reason] ?? creatorAdultGateUnnamedMessage;
}

/**
 * The creator's own standing, as its holder may see it.
 *
 * The coarse reason the server publishes is repeated verbatim rather than
 * expanded: enforcement detail is a Trust & Safety fact, and inventing an
 * explanation here would be inventing policy.
 */
export type CreatorStanding = 'active' | 'applicant' | 'suspended' | 'closed';

export function creatorStanding(account: CreatorAccount): CreatorStanding {
  switch (account.status) {
    case 'active': {
      return 'active';
    }
    case 'applicant': {
      return 'applicant';
    }
    case 'suspended': {
      return 'suspended';
    }
    default: {
      return 'closed';
    }
  }
}

export const creatorStandingLabels: Readonly<Record<CreatorStanding, string>> =
  {
    active: 'Creator access active',
    applicant: 'Creator access requested, not finished',
    closed: 'Creator access is closed',
    suspended: 'Creator access is suspended',
  };

/** Whether the public page for this profile is currently reachable. */
export type CreatorPublicationView = 'none' | 'draft' | 'published';

export function publicationView(
  profile: CreatorProfile | undefined,
): CreatorPublicationView {
  if (profile === undefined) return 'none';
  return profile.publication === 'published' ? 'published' : 'draft';
}

export const publicationLabels: Readonly<
  Record<CreatorPublicationView, string>
> = {
  draft: 'Draft. Only you can see this.',
  none: 'No public profile yet',
  published: 'Published. Anyone with the link can see this.',
};

/**
 * What to tell somebody about a call that did not succeed.
 *
 * One sentence per branch, none of which describes another creator. A conflict
 * reads as a conflict, because the server deliberately does not say whether a
 * handle was taken, an edit was stale, or a capability may not act — and a
 * client that guessed would be creating the disclosure the server withheld.
 *
 * `conflict` lets a caller name the two things a conflict could be *on that
 * screen* without narrowing which one happened. A club form saying a handle was
 * unavailable would be wrong about the noun while still being right about the
 * ambiguity, which is the worst of both.
 */
export function failureMessage(
  result: ApiResult<unknown>,
  copy: { readonly conflict?: string } = {},
): string | undefined {
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
      if (result.code === 'STATE_CONFLICT' && copy.conflict !== undefined) {
        return copy.conflict;
      }
      return refusalMessages[result.code] ?? 'That is not possible right now.';
    }
  }
}

const refusalMessages: Readonly<Record<string, string>> = {
  ACCOUNT_NOT_ELIGIBLE:
    'Your creator access cannot do that in its current state.',
  ACTION_NOT_PERMITTED: 'That is not possible right now.',
  CREATOR_SURFACE_REQUIRED: 'Sign in again in Creator Studio.',
  DEPENDENCY_UNAVAILABLE:
    'That is not available in this environment yet. Nothing was lost.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  STATE_CONFLICT:
    'That is already taken, or it changed somewhere else while you were working. Reload and try again.',
  VALIDATION_FAILED: 'Check the details and try again.',
};

/**
 * Whether a failed action is worth offering a retry for. A refusal is a
 * decision and repeating it changes nothing; an unreachable server is a
 * condition and repeating it may.
 */
export function isRetryable(result: ApiResult<unknown>): boolean {
  return result.kind === 'unavailable';
}
