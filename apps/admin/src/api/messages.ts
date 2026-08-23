import type { ApiResult } from '@velora/api-client';

/**
 * What to tell an operator about a call that did not succeed.
 *
 * One sentence per branch, and none of them guesses. The distinction that
 * matters most on this surface is between **refused** and **failed**: a refusal
 * is the platform working correctly and repeating it changes nothing, while an
 * unreachable API is a condition that repeating may clear. An operator who
 * cannot tell those apart either gives up on something that would have worked
 * or hammers something that never will.
 *
 * A 403 here is deliberately one message. The server does not say whether the
 * audience was wrong or the assurance was insufficient or stale, because which
 * condition failed is not a caller's business — an operator knows whether they
 * are an operator, and anybody else learns nothing.
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
      return 'This session is not signed in, or it has ended. Nothing was read.';
    }
    case 'not-found': {
      return 'There is no such record, or it is not one this console may read.';
    }
    case 'unavailable': {
      return 'VELORA could not be reached. Nothing was sent, and trying again may work.';
    }
    default: {
      if (result.code === 'STATE_CONFLICT' && copy.conflict !== undefined) {
        return copy.conflict;
      }
      return refusalMessages[result.code] ?? 'That is not permitted.';
    }
  }
}

const refusalMessages: Readonly<Record<string, string>> = {
  ACTION_NOT_PERMITTED:
    'Privileged access was refused. It requires a Platform Admin session whose authenticator is phishing-resistant and recently used.',
  CSRF_REJECTED:
    'That request did not carry a valid token for this session. Reload and try again.',
  DEPENDENCY_UNAVAILABLE:
    'The capability behind that operation is not available in this environment. Nothing was changed.',
  ORIGIN_REJECTED:
    'This origin is not one the platform admits for privileged access.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  STATE_CONFLICT:
    'The record changed since this page read it. Reload and look at the current state before acting.',
  VALIDATION_FAILED: 'Check the details and try again.',
};

/**
 * Whether a failed call is worth offering a retry for.
 *
 * A refusal is a decision and repeating it changes nothing; an unreachable
 * server is a condition and repeating it may.
 */
export function isRetryable(result: ApiResult<unknown>): boolean {
  return result.kind === 'unavailable';
}

/**
 * Whether the platform refused because this browser may not hold privileged
 * access at all.
 *
 * This is the answer every read on this surface currently gets, so the console
 * distinguishes it from an ordinary failure and explains it once rather than
 * printing an error on ten panels.
 */
export function isPrivilegeRefusal(result: ApiResult<unknown>): boolean {
  return (
    result.kind === 'unauthenticated' ||
    (result.kind === 'refused' && result.code === 'ACTION_NOT_PERMITTED')
  );
}
