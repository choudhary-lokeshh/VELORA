'use client';

import { useCallback } from 'react';

import type {
  ApiResult,
  ConsumerAccount,
  ConsumerApi,
  ConsumerProfile,
  OnboardingState,
} from '@velora/consumer-client';
import { useResource, useRevalidateOnFocus, type Resource } from './resource';

/**
 * "You do not have one yet" is a product state, not a failure.
 *
 * A consumer who has authenticated but never created an account gets the same
 * 404 as a route that does not exist — deliberately, because the API refuses to
 * disclose which. On these three reads the client already knows which it is: it
 * is asking about itself. Turning that into an absent value rather than an
 * error is what lets the surface offer the next step instead of an apology.
 */
function absentIsEmpty<T>(result: ApiResult<T>): ApiResult<T | undefined> {
  return result.kind === 'not-found'
    ? { kind: 'ok', value: undefined }
    : result;
}

/**
 * The three answers every surface needs about the person using it.
 *
 * They are read together because they change together: finishing onboarding
 * changes the account status, saving a profile changes the outstanding
 * requirements, and becoming discoverable changes what discovery will return.
 * Reading them separately would let one screen act on an account state another
 * screen had already invalidated.
 *
 * Nothing here is remembered beyond the current answer. A profile edited in
 * another tab, an account restricted by enforcement, or an onboarding step
 * completed on a phone all reach this tab the same way: it asks again.
 */
export interface AccountState {
  readonly account: Resource<ConsumerAccount | undefined>;
  readonly onboarding: Resource<OnboardingState | undefined>;
  readonly profile: Resource<ConsumerProfile | undefined>;
  readonly reloadAll: () => void;
  /**
   * Whether the account and its admission step have both been answered.
   *
   * Every gate waits for this. Acting on an unanswered read is how a signed-in,
   * admitted person gets bounced back to onboarding for a frame and then
   * forward again, which is a redirect loop somebody can actually see.
   */
  readonly settled: boolean;
}

export function useAccountState(input: {
  readonly api: ConsumerApi;
  readonly enabled: boolean;
  /** Told when the server says the session is gone. */
  readonly onSessionEnded: () => void;
}): AccountState {
  const { api, enabled, onSessionEnded } = input;

  const loadAccount = useCallback(
    async (signal: AbortSignal) => absentIsEmpty(await api.account(signal)),
    [api],
  );
  const loadOnboarding = useCallback(
    async (signal: AbortSignal) => absentIsEmpty(await api.onboarding(signal)),
    [api],
  );
  const loadProfile = useCallback(
    async (signal: AbortSignal) => absentIsEmpty(await api.profile(signal)),
    [api],
  );

  const options = { enabled, onUnauthenticated: onSessionEnded };
  const account = useResource(loadAccount, options);
  const onboarding = useResource(loadOnboarding, options);
  const profile = useResource(loadProfile, options);

  const reloadAll = useCallback(() => {
    account.reload();
    onboarding.reload();
    profile.reload();
  }, [account, onboarding, profile]);

  useRevalidateOnFocus(reloadAll);

  return {
    account,
    onboarding,
    profile,
    reloadAll,
    settled: account.settled && onboarding.settled,
  };
}
