import type { ApiResult, ConsumerApi } from '@velora/consumer-client';
import {
  accountStanding,
  accountStandingLabels,
  failureMessage,
  journeyStage,
  journeyStageLabels,
  type JourneyStage,
} from '@velora/consumer-client';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { resolveApiBaseUrl } from '../api';
import { createPlatformSecureTokenStore } from '../auth/secure-storage';
import type { SecureTokenStore } from '../auth/secure-storage';
import {
  createMobileAuthManager,
  initialMobileAuthState,
  type MobileAuthManager,
  type MobileAuthState,
} from '../auth/session';
import { useAccountState, type AccountState } from './account';
import { createMobileConsumerApi } from './api';
import {
  ConversationsArea,
  DiscoveryArea,
  IntroductionsArea,
  NotificationsArea,
  ProfileArea,
  SafetyArea,
} from './areas';
import { useRevalidateOnForeground, useSingleFlight } from './resource';
import { Action, ErrorMessage, Section, StatusMessage } from './ui';

/**
 * Consumer Mobile.
 *
 * The lifecycle differs from a browser's and the surface is built for it. A
 * cold launch restores the session from platform-keystore-backed storage before
 * asking the server anything; a warm launch that was suspended for an hour asks
 * again the moment it is foregrounded; an offline launch keeps the stored
 * session and says the service could not be reached rather than claiming the
 * person is signed out.
 *
 * Everything else follows the same rule as every other VELORA surface: the
 * server decides, the client renders the answer, and nothing is cached that
 * would let this app act on a decision the server has since changed.
 *
 * V1 has one authenticated surface with peer areas rather than a stack, so
 * there is no navigation state to restore beyond which area was open — which is
 * held here and survives a foreground because the component does.
 */

const productAreas = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'introductions', label: 'Introductions' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'profile', label: 'Profile' },
  { id: 'safety', label: 'Safety' },
] as const;

type AreaId = (typeof productAreas)[number]['id'];

export const mobileAuthMessages: Readonly<
  Record<MobileAuthState['status'], string>
> = {
  authenticated: 'Signed in',
  loading: 'Checking session',
  unauthenticated: 'Signed out',
  unavailable: 'VELORA could not be reached',
};

export function ConsumerApp({
  apiBaseUrl,
  fetchImplementation,
  store,
}: {
  /** Resolved on demand so importing this module can never crash a screen. */
  readonly apiBaseUrl?: string;
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly store?: SecureTokenStore;
}) {
  const [endpointFailed, setEndpointFailed] = useState(false);
  const auth = useMemo<MobileAuthManager | undefined>(() => {
    try {
      return createMobileAuthManager({
        apiBaseUrl: apiBaseUrl ?? resolveApiBaseUrl(),
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        store: store ?? createPlatformSecureTokenStore(),
      });
    } catch {
      // A build with no usable endpoint must say so rather than render a
      // surface every control on which would fail.
      return undefined;
    }
  }, [apiBaseUrl, fetchImplementation, store]);

  const api = useMemo<ConsumerApi | undefined>(
    () =>
      auth === undefined
        ? undefined
        : createMobileConsumerApi({
            apiBaseUrl: apiBaseUrl ?? resolveApiBaseUrl(),
            auth,
            ...(fetchImplementation === undefined
              ? {}
              : { fetch: fetchImplementation }),
          }),
    [apiBaseUrl, auth, fetchImplementation],
  );

  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);
  const [subject, setSubject] = useState('person@velora.test');
  const [area, setArea] = useState<AreaId>('discovery');
  // The shared guard, not a local one. A guard held in component state is not a
  // guard: two taps in the same frame both read it as it was before either
  // committed, so both fire — two sessions created for one press of "Sign in",
  // and two answers racing into the same state. The ref inside this hook is
  // written synchronously, so the second tap sees the first.
  const { busy, run: runAuth } = useSingleFlight();

  const restore = useCallback(() => {
    if (auth === undefined) {
      setEndpointFailed(true);
      return;
    }
    void auth.restore().then(setState);
  }, [auth]);

  useEffect(restore, [restore]);
  // Coming back to the foreground is the moment a stored session is most likely
  // to have expired behind the app's back.
  useRevalidateOnForeground(restore);

  const signedIn = state.status === 'authenticated';
  const account = useAccountState({
    api,
    enabled: signedIn,
    onSessionEnded: restore,
  });

  const run = (work: () => Promise<MobileAuthState>) => {
    runAuth(async () => {
      setState(await work());
    });
  };

  if (endpointFailed || auth === undefined || api === undefined) {
    return (
      <View accessibilityRole="summary">
        <Text accessibilityRole="header">VELORA</Text>
        <ErrorMessage testID="endpoint-unavailable">
          This build has no usable VELORA endpoint.
        </ErrorMessage>
      </View>
    );
  }

  return (
    // A plain view, not a scroll view. Every product area owns a virtualised
    // list, and React Native refuses to nest one inside a scroll view of the
    // same orientation — for good reason: the outer view would render every row
    // and undo the virtualisation the inner list exists to provide.
    <View>
      <Text accessibilityRole="header">VELORA</Text>
      <Section title="Session">
        <StatusMessage testID="auth-status">
          {mobileAuthMessages[state.status]}
        </StatusMessage>
        {state.status === 'unauthenticated' ? (
          <Text testID="auth-cause">{state.cause}</Text>
        ) : null}
        {signedIn ? (
          <>
            <Action
              disabled={busy}
              label="Sign out"
              onPress={() => {
                run(async () => auth.signOut());
              }}
              testID="auth-sign-out"
            />
            <Action
              disabled={busy}
              label="Sign out everywhere"
              onPress={() => {
                run(async () => auth.signOutEverywhere());
              }}
              testID="auth-sign-out-everywhere"
            />
          </>
        ) : (
          <>
            <TextInput
              accessibilityLabel="Development identity"
              autoCapitalize="none"
              onChangeText={setSubject}
              testID="auth-subject"
              value={subject}
            />
            <Action
              disabled={busy}
              label="Sign in"
              onPress={() => {
                run(async () =>
                  auth.signIn({
                    installationId: 'installation-local-device',
                    subject,
                  }),
                );
              }}
              testID="auth-sign-in"
            />
          </>
        )}
      </Section>

      {signedIn ? (
        <SignedIn account={account} api={api} area={area} onArea={setArea} />
      ) : null}
      <StatusBar style="auto" />
    </View>
  );
}

function SignedIn({
  account,
  api,
  area,
  onArea,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly area: AreaId;
  readonly onArea: (next: AreaId) => void;
}) {
  const stage: JourneyStage = journeyStage(account.onboarding.value);
  const current = account.account.value;

  if (account.account.error !== undefined) {
    return (
      <Section title="Account">
        <ErrorMessage testID="account-failed">
          {account.account.error}
        </ErrorMessage>
        <Action
          label="Try again"
          onPress={account.reloadAll}
          testID="account-retry"
        />
      </Section>
    );
  }
  if (account.account.loading && current === undefined) {
    return (
      <Section title="Account">
        <StatusMessage testID="account-loading">
          Loading your account…
        </StatusMessage>
      </Section>
    );
  }
  if (current === undefined) {
    return (
      <Section title="Account">
        <StatusMessage testID="account-required">
          You do not have a VELORA account yet.
        </StatusMessage>
        <Action
          label="Create account"
          onPress={() => {
            void api.createAccount().then(account.reloadAll);
          }}
          testID="create-account"
        />
      </Section>
    );
  }

  return (
    <>
      <Section title="Account">
        <StatusMessage testID="account-standing">
          {accountStandingLabels[accountStanding(current)]}
        </StatusMessage>
        <Text testID="journey-stage">{journeyStageLabels[stage]}</Text>
      </Section>

      {stage === 'ready' ? (
        <>
          <View accessibilityRole="tablist">
            {productAreas.map((entry) => (
              <Action
                key={entry.id}
                label={`${entry.id === area ? '• ' : ''}${entry.label}`}
                onPress={() => {
                  onArea(entry.id);
                }}
                testID={`nav-${entry.id}`}
              />
            ))}
          </View>
          <ProductArea account={account} api={api} area={area} />
        </>
      ) : (
        <Onboarding account={account} api={api} stage={stage} />
      )}
    </>
  );
}

function ProductArea({
  account,
  api,
  area,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly area: AreaId;
}) {
  switch (area) {
    case 'discovery': {
      return <DiscoveryArea api={api} />;
    }
    case 'introductions': {
      return <IntroductionsArea api={api} />;
    }
    case 'conversations': {
      return <ConversationsArea api={api} />;
    }
    case 'notifications': {
      return <NotificationsArea api={api} />;
    }
    case 'profile': {
      return <ProfileArea account={account} api={api} />;
    }
    default: {
      return <SafetyArea api={api} />;
    }
  }
}

/**
 * Adult assurance, policy acknowledgement, and the minimum profile.
 *
 * The ladder is the server's; this asks for whatever it says is outstanding.
 * A photo cannot be supplied here: no media storage provider is approved, and
 * the surface says so rather than offering a control that cannot work.
 */
function Onboarding({
  account,
  api,
  stage,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly stage: JourneyStage;
}) {
  const [region, setRegion] = useState('ES');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  const onboarding = account.onboarding.value;

  const submit = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(undefined);
      setMessage(failureMessage(await work()));
      account.reloadAll();
    });
  };

  return (
    <Section title="Getting started">
      {message === undefined ? null : (
        <ErrorMessage testID="onboarding-error">{message}</ErrorMessage>
      )}
      {stage === 'adult_declaration' ? (
        <>
          <TextInput
            accessibilityLabel="Country or region"
            autoCapitalize="characters"
            maxLength={2}
            onChangeText={setRegion}
            testID="onboarding-region"
            value={region}
          />
          <Text>
            VELORA is adults only. Confirming here is a declaration, not a
            verified age check.
          </Text>
          <Action
            disabled={busy}
            label="I am an adult"
            onPress={() => {
              submit(async () => api.declareAdult(region));
            }}
            testID="declare-adult"
          />
        </>
      ) : null}

      {stage === 'policy_acknowledgement' ? (
        <Action
          disabled={busy}
          label="Accept the policies"
          onPress={() => {
            submit(async () =>
              api.acknowledgePolicies(onboarding?.outstandingPolicies ?? []),
            );
          }}
          testID="acknowledge-policies"
        />
      ) : null}

      {stage === 'profile' ? (
        <>
          <TextInput
            accessibilityLabel="Display name"
            onChangeText={setDisplayName}
            testID="onboarding-display-name"
            value={displayName}
          />
          <Action
            disabled={busy}
            label="Save profile"
            onPress={() => {
              submit(async () =>
                api.saveProfile({ displayName, languages: ['es'] }),
              );
            }}
            testID="save-profile"
          />
          <StatusMessage testID="onboarding-photo-note">
            A photo is still required, and photo storage is not available in
            this environment yet.
          </StatusMessage>
        </>
      ) : null}
    </Section>
  );
}
