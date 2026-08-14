import type {
  ApiResult,
  ConsumerAccount,
  ConsumerApi,
  ConsumerProfile,
  OnboardingState,
} from '@velora/consumer-client';
import { useCallback } from 'react';

import {
  useResource,
  useRevalidateOnForeground,
  type Resource,
} from './resource';

/**
 * The three answers every screen needs about the person using the app.
 *
 * Read together because they change together, and re-read whenever the app
 * comes back to the foreground: a phone that has been in a pocket for an hour
 * knows nothing about a session that expired, a profile edited on the web, or
 * an account that was restricted.
 */
export interface AccountState {
  readonly account: Resource<ConsumerAccount | undefined>;
  readonly onboarding: Resource<OnboardingState | undefined>;
  readonly profile: Resource<ConsumerProfile | undefined>;
  readonly reloadAll: () => void;
}

/**
 * "You do not have one yet" is a product state, not a failure.
 *
 * A consumer who has authenticated but never created an account gets the same
 * 404 as a route that does not exist — deliberately, because the API refuses to
 * disclose which. On these three reads the client already knows which it is: it
 * is asking about itself.
 */
function absentIsEmpty<T>(result: ApiResult<T>): ApiResult<T | undefined> {
  return result.kind === 'not-found'
    ? { kind: 'ok', value: undefined }
    : result;
}

/**
 * The API is optional because a build with no usable endpoint still renders,
 * and hooks cannot be called conditionally. An absent client answers
 * `unavailable` rather than pretending to have asked anything.
 */
const unreachable: ApiResult<never> = { kind: 'unavailable' };

export function useAccountState(input: {
  readonly api: ConsumerApi | undefined;
  readonly enabled: boolean;
  readonly onSessionEnded: () => void;
}): AccountState {
  const { api, enabled, onSessionEnded } = input;

  const loadAccount = useCallback(
    async (signal: AbortSignal) =>
      api === undefined
        ? unreachable
        : absentIsEmpty(await api.account(signal)),
    [api],
  );
  const loadOnboarding = useCallback(
    async (signal: AbortSignal) =>
      api === undefined
        ? unreachable
        : absentIsEmpty(await api.onboarding(signal)),
    [api],
  );
  const loadProfile = useCallback(
    async (signal: AbortSignal) =>
      api === undefined
        ? unreachable
        : absentIsEmpty(await api.profile(signal)),
    [api],
  );

  const options = {
    enabled: enabled && api !== undefined,
    onUnauthenticated: onSessionEnded,
  };
  const account = useResource(loadAccount, options);
  const onboarding = useResource(loadOnboarding, options);
  const profile = useResource(loadProfile, options);

  const reloadAll = useCallback(() => {
    account.reload();
    onboarding.reload();
    profile.reload();
  }, [account, onboarding, profile]);

  useRevalidateOnForeground(reloadAll);

  return { account, onboarding, profile, reloadAll };
}
