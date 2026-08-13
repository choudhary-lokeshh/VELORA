import type { AuthAssurance, AuthAudience } from '@velora/validation';

import {
  assuranceAtLeast,
  minimumAssuranceByAudience,
  stepUpAssuranceMaximumAgeMilliseconds,
} from './policy.js';

/**
 * The server's own view of who is calling. It is derived from stored state on
 * every request and contains no credential, no token, no cookie, and no client
 * assertion. Nothing a client sends other than the credential itself
 * contributes to it, which is what makes it usable as authorization input.
 */
export interface AuthContext {
  readonly accountId: string;
  readonly assurance: AuthAssurance;
  readonly assuranceEstablishedAt: Date;
  readonly audience: AuthAudience;
  readonly authenticatedAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
  /** Present for browser sessions. */
  readonly sessionId?: string;
  /** Present for Consumer Mobile access tokens. */
  readonly refreshFamilyId?: string;
  readonly transport: 'cookie' | 'bearer';
}

export class AuthorizationError extends Error {
  constructor(
    readonly kind:
      | 'authentication_required'
      | 'audience_rejected'
      | 'assurance_insufficient'
      | 'assurance_stale'
      | 'high_impact_restricted',
  ) {
    // The message never travels to a client; the route layer maps `kind` to a
    // stable code and a generic message.
    super(`Authorization denied: ${kind}`);
    this.name = 'AuthorizationError';
  }
}

/** Deny by default: an absent context is never treated as anonymous-allowed. */
export function requireAuthenticated(
  context: AuthContext | undefined,
): AuthContext {
  if (context === undefined) {
    throw new AuthorizationError('authentication_required');
  }
  return context;
}

export function requireAudience(
  context: AuthContext | undefined,
  allowed: readonly AuthAudience[],
): AuthContext {
  const authenticated = requireAuthenticated(context);
  if (!allowed.includes(authenticated.audience)) {
    throw new AuthorizationError('audience_rejected');
  }
  return authenticated;
}

export function requireAssurance(
  context: AuthContext | undefined,
  required: AuthAssurance,
): AuthContext {
  const authenticated = requireAuthenticated(context);
  // The audience floor applies as well, so an audience that structurally
  // requires phishing-resistant authentication cannot be satisfied by a caller
  // that merely meets the argument.
  const floor = minimumAssuranceByAudience[authenticated.audience];
  if (
    !assuranceAtLeast(authenticated.assurance, required) ||
    !assuranceAtLeast(authenticated.assurance, floor)
  ) {
    throw new AuthorizationError('assurance_insufficient');
  }
  return authenticated;
}

/**
 * High-impact actions need assurance established recently, not merely present.
 * ADR-0017 fixes the maximum age.
 */
export function requireFreshAssurance(
  context: AuthContext | undefined,
  required: AuthAssurance,
  now: Date,
): AuthContext {
  const authenticated = requireAssurance(context, required);
  const age = now.getTime() - authenticated.assuranceEstablishedAt.getTime();
  if (age > stepUpAssuranceMaximumAgeMilliseconds || age < 0) {
    throw new AuthorizationError('assurance_stale');
  }
  return authenticated;
}
