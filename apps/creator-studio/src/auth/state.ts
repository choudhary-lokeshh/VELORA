import type { AuthSessionResponse, CreatorAuthOutcome } from './client';

/**
 * Creator Studio authentication state.
 *
 * The server answers every failed session check identically, on purpose: it
 * does not disclose whether a session expired, was revoked, or never existed.
 * The client therefore reports what it can honestly observe — that the session
 * it was using has ended — rather than inventing a cause.
 */
export type CreatorAuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly session: AuthSessionResponse }
  | {
      readonly status: 'unauthenticated';
      readonly cause: 'initial' | 'session_ended' | 'signed_out';
    }
  | { readonly status: 'rejected'; readonly code: string }
  | { readonly status: 'unavailable' };

export const initialCreatorAuthState: CreatorAuthState = { status: 'loading' };

export type CreatorAuthEvent =
  | { readonly type: 'session-result'; readonly outcome: CreatorAuthOutcome }
  | { readonly type: 'sign-in-result'; readonly outcome: CreatorAuthOutcome }
  | { readonly type: 'logout-result'; readonly outcome: CreatorAuthOutcome };

function fromOutcome(
  outcome: CreatorAuthOutcome,
  cause: Extract<CreatorAuthState, { status: 'unauthenticated' }>['cause'],
): CreatorAuthState {
  switch (outcome.kind) {
    case 'authenticated': {
      return { session: outcome.session, status: 'authenticated' };
    }
    case 'unauthenticated': {
      return { cause, status: 'unauthenticated' };
    }
    case 'rejected': {
      return { code: outcome.code, status: 'rejected' };
    }
    default: {
      return { status: 'unavailable' };
    }
  }
}

export function reduceCreatorAuth(
  state: CreatorAuthState,
  event: CreatorAuthEvent,
): CreatorAuthState {
  switch (event.type) {
    case 'session-result': {
      // A failed check after the client had a session means the session ended;
      // before that it means nobody has signed in here. Once said, a second
      // failing check must not downgrade it back to "no active session".
      return fromOutcome(
        event.outcome,
        state.status === 'authenticated'
          ? 'session_ended'
          : state.status === 'unauthenticated'
            ? state.cause
            : 'initial',
      );
    }
    case 'sign-in-result': {
      return fromOutcome(event.outcome, 'initial');
    }
    default: {
      return fromOutcome(event.outcome, 'signed_out');
    }
  }
}

export const creatorAuthMessages: Readonly<
  Record<CreatorAuthState['status'], string>
> = {
  authenticated: 'Signed in',
  loading: 'Checking session',
  rejected: 'Request refused',
  unauthenticated: 'Signed out',
  unavailable: 'Authentication service unavailable',
};

export const creatorAuthCauseMessages: Readonly<
  Record<
    Extract<CreatorAuthState, { status: 'unauthenticated' }>['cause'],
    string
  >
> = {
  initial: 'No active session',
  session_ended: 'Session ended. Sign in again.',
  signed_out: 'Signed out on this device',
};
