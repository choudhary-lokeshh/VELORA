import type { AuthOutcome, AuthSessionResponse } from './client';

/**
 * Consumer Web authentication state.
 *
 * The server answers every failed session check identically, on purpose: it
 * does not disclose whether a session expired, was revoked, or never existed.
 * The client therefore reports what it can honestly observe — that the session
 * it was using has ended — rather than inventing a cause.
 */
export type ConsumerAuthState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'authenticated';
      readonly session: AuthSessionResponse;
    }
  | {
      readonly status: 'unauthenticated';
      readonly cause:
        'initial' | 'session_ended' | 'signed_out' | 'signed_out_everywhere';
    }
  | { readonly status: 'rejected'; readonly code: string }
  | { readonly status: 'unavailable' };

export const initialConsumerAuthState: ConsumerAuthState = {
  status: 'loading',
};

export type ConsumerAuthEvent =
  | { readonly type: 'bootstrap' }
  | { readonly type: 'sign-in-result'; readonly outcome: AuthOutcome }
  | { readonly type: 'session-result'; readonly outcome: AuthOutcome }
  | { readonly type: 'logout-result'; readonly outcome: AuthOutcome }
  | {
      readonly type: 'logout-everywhere-result';
      readonly outcome: AuthOutcome;
    };

function fromOutcome(
  outcome: AuthOutcome,
  unauthenticatedCause: Extract<
    ConsumerAuthState,
    { status: 'unauthenticated' }
  >['cause'],
): ConsumerAuthState {
  switch (outcome.kind) {
    case 'authenticated': {
      return { session: outcome.session, status: 'authenticated' };
    }
    case 'unauthenticated': {
      return { cause: unauthenticatedCause, status: 'unauthenticated' };
    }
    case 'rejected': {
      return { code: outcome.code, status: 'rejected' };
    }
    default: {
      return { status: 'unavailable' };
    }
  }
}

export function reduceConsumerAuth(
  state: ConsumerAuthState,
  event: ConsumerAuthEvent,
): ConsumerAuthState {
  switch (event.type) {
    case 'bootstrap': {
      return { status: 'loading' };
    }
    case 'session-result': {
      // A session check that fails after the client had one means the session
      // ended; before that it simply means nobody has signed in here.
      return fromOutcome(
        event.outcome,
        state.status === 'authenticated' ? 'session_ended' : 'initial',
      );
    }
    case 'sign-in-result': {
      return fromOutcome(event.outcome, 'initial');
    }
    case 'logout-result': {
      return fromOutcome(event.outcome, 'signed_out');
    }
    default: {
      return fromOutcome(event.outcome, 'signed_out_everywhere');
    }
  }
}

export const consumerAuthMessages: Readonly<
  Record<ConsumerAuthState['status'], string>
> = {
  authenticated: 'Signed in',
  loading: 'Checking session',
  rejected: 'Request refused',
  unauthenticated: 'Signed out',
  unavailable: 'Authentication service unavailable',
};

export const consumerAuthCauseMessages: Readonly<
  Record<
    Extract<ConsumerAuthState, { status: 'unauthenticated' }>['cause'],
    string
  >
> = {
  initial: 'No active session',
  session_ended: 'Session ended. Sign in again.',
  signed_out: 'Signed out on this device',
  signed_out_everywhere: 'Signed out everywhere',
};
