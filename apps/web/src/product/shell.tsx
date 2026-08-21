'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';

import { createConsumerWebAuthClient } from '../auth/client';
import {
  consumerAuthCauseMessages,
  consumerAuthMessages,
  initialConsumerAuthState,
  reduceConsumerAuth,
} from '../auth/state';
import type { ConsumerApi, JourneyStage } from '@velora/consumer-client';
import {
  accountStanding,
  accountStandingLabels,
  journeyStage,
  journeyStageLabels,
} from '@velora/consumer-client';
import { createWebConsumerApi } from './api';
import { AvailabilityPanel } from './availability';
import { CallsPanel } from './calls';
import { ConversationsPanel } from './conversations';
import { DiscoveryPanel } from './discovery';
import { IntroductionsPanel } from './introductions';
import { Memberships } from './memberships';
import { NotificationsPanel } from './notifications';
import { OnboardingPanel } from './onboarding';
import { ProfilePanel } from './profile';
import { useAccountState, type AccountState } from './account';
import { useRevalidateOnFocus, useSingleFlight } from './resource';
import { SafetyPanel } from './safety';
import { ErrorMessage, Section, StatusMessage } from './ui';

/**
 * Consumer Web's product root.
 *
 * It owns two things and delegates everything else: whether there is a live
 * session, and which part of the journey the server says the person is in.
 * Every screen below it reads its own data from the API and renders the answer;
 * none of them decides whether an action is allowed, because none of them can.
 *
 * The surface deliberately holds no cached authorization. A tab that has been
 * in the background revalidates before the person acts on what it is showing,
 * and a request the server refuses is rendered as a refusal rather than
 * reconciled against whatever this tab last believed.
 */

const productSections = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'introductions', label: 'Introductions' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'calls', label: 'Calls' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'memberships', label: 'Memberships' },
  { id: 'profile', label: 'Profile' },
  { id: 'safety', label: 'Safety' },
] as const;

type SectionId = (typeof productSections)[number]['id'];

export function ConsumerShell({
  apiBaseUrl,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the journey runs without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const authClient = useMemo(
    () =>
      createConsumerWebAuthClient({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    [apiBaseUrl, fetchImplementation],
  );
  const api = useMemo<ConsumerApi>(
    () =>
      createWebConsumerApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    [apiBaseUrl, fetchImplementation],
  );

  const [auth, dispatch] = useReducer(
    reduceConsumerAuth,
    initialConsumerAuthState,
  );
  const [subject, setSubject] = useState('person@velora.test');
  const { busy, run: runAuth } = useSingleFlight();

  const checkSession = useCallback(() => {
    void authClient.session().then((outcome) => {
      dispatch({ outcome, type: 'session-result' });
    });
  }, [authClient]);

  // The browser holds no session state of its own, so the first thing this
  // surface does is ask whether the cookie it may be carrying is still live.
  useEffect(checkSession, [checkSession]);

  // A session can end in another tab, on another device, or by expiring. This
  // tab therefore asks again whenever it becomes the one being looked at,
  // rather than trusting what it believed when it was last in front.
  useRevalidateOnFocus(checkSession);

  const signedIn = auth.status === 'authenticated';
  // Nothing is offered until the session check has answered. This is the one
  // state the server cannot render: the page is delivered before anybody knows
  // whose it is, so a sign-in form in that markup is a control that is visible
  // and pressable while nothing is listening yet. A press landing in that
  // window is discarded silently — no request, no navigation, no message — and
  // the same markup would invite somebody who is already signed in to sign in
  // again. Both stop being possible when the form waits for the answer.
  const sessionKnown = auth.status !== 'loading';
  const account = useAccountState({
    api,
    enabled: signedIn,
    onSessionEnded: checkSession,
  });

  // One authentication action at a time: two clicks on "sign out" would
  // otherwise revoke twice and race their answers into the same reducer.
  const run = runAuth;

  return (
    <main className="shell">
      <header>
        <p className="wordmark">VELORA</p>
        <h1>Consumer</h1>
      </header>

      <Section headingId="session-heading" title="Session">
        <StatusMessage testId="auth-status">
          {consumerAuthMessages[auth.status]}
        </StatusMessage>
        {auth.status === 'unauthenticated' ? (
          <p data-testid="auth-cause">
            {consumerAuthCauseMessages[auth.cause]}
          </p>
        ) : null}
        {auth.status === 'rejected' ? (
          <ErrorMessage testId="auth-rejected">
            Sign-in was refused.
          </ErrorMessage>
        ) : null}
        {auth.status === 'unavailable' ? (
          <ErrorMessage testId="auth-unavailable">
            VELORA could not be reached. Try again.
          </ErrorMessage>
        ) : null}

        {auth.status === 'authenticated' ? (
          <dl>
            <dt>Audience</dt>
            <dd data-testid="auth-audience">{auth.session.audience}</dd>
            <dt>Assurance</dt>
            <dd data-testid="auth-assurance">{auth.session.assurance}</dd>
          </dl>
        ) : null}

        {signedIn ? (
          <div className="row">
            <button
              data-testid="auth-refresh"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  dispatch({
                    outcome: await authClient.session(),
                    type: 'session-result',
                  });
                });
              }}
              type="button"
            >
              Check session
            </button>
            <button
              data-testid="auth-sign-out"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  dispatch({
                    outcome: await authClient.logout(),
                    type: 'logout-result',
                  });
                });
              }}
              type="button"
            >
              Sign out
            </button>
            <button
              data-testid="auth-sign-out-everywhere"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  dispatch({
                    outcome: await authClient.logoutEverywhere(),
                    type: 'logout-everywhere-result',
                  });
                });
              }}
              type="button"
            >
              Sign out everywhere
            </button>
          </div>
        ) : null}

        {!signedIn && sessionKnown ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                dispatch({
                  outcome: await authClient.signIn(subject),
                  type: 'sign-in-result',
                });
              });
            }}
          >
            <label htmlFor="auth-subject">Development identity</label>
            <input
              autoComplete="username"
              id="auth-subject"
              name="subject"
              onChange={(event) => {
                setSubject(event.target.value);
              }}
              required
              value={subject}
            />
            <button data-testid="auth-sign-in" disabled={busy} type="submit">
              Sign in
            </button>
          </form>
        ) : null}
      </Section>

      {signedIn ? (
        <SignedIn account={account} api={api} onSessionEnded={checkSession} />
      ) : null}
    </main>
  );
}

/**
 * Everything behind a live session.
 *
 * The journey gate is not cosmetic. Discovery, introductions, and messaging are
 * refused by the server until the account is admitted, so showing them before
 * that would be offering actions that can only fail. The gate reflects the
 * server's own answer rather than a rule this file re-derives.
 */
function SignedIn({
  account,
  api,
  onSessionEnded,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly onSessionEnded: () => void;
}) {
  const [section, setSection] = useState<SectionId>('discovery');
  const stage: JourneyStage = journeyStage(account.onboarding.value);

  if (account.account.error !== undefined) {
    return (
      <Section headingId="account-heading" title="Account">
        <ErrorMessage testId="account-failed">
          {account.account.error}
        </ErrorMessage>
        <button onClick={account.reloadAll} type="button">
          Try again
        </button>
      </Section>
    );
  }

  if (account.account.loading && account.account.value === undefined) {
    return (
      <Section headingId="account-heading" title="Account">
        <StatusMessage testId="account-loading">
          Loading your account…
        </StatusMessage>
      </Section>
    );
  }

  const current = account.account.value;
  if (current === undefined) {
    return (
      <Section headingId="account-heading" title="Account">
        <StatusMessage testId="account-required">
          You do not have a VELORA account yet.
        </StatusMessage>
        <button
          data-testid="create-account"
          onClick={() => {
            void api.createAccount().then(account.reloadAll);
          }}
          type="button"
        >
          Create account
        </button>
      </Section>
    );
  }

  const standing = accountStanding(current);

  return (
    <>
      <Section headingId="account-heading" title="Account">
        <StatusMessage testId="account-standing">
          {accountStandingLabels[standing]}
        </StatusMessage>
        <p data-testid="journey-stage">{journeyStageLabels[stage]}</p>
        {standing === 'restricted' ? (
          // Said once, to the account it describes, in the coarse terms the
          // server publishes. No enforcement detail and no appeal invented here.
          <ErrorMessage testId="account-restricted">
            Some actions are unavailable while this account is restricted.
          </ErrorMessage>
        ) : null}
      </Section>

      {stage === 'ready' ? null : (
        <OnboardingPanel account={account} api={api} stage={stage} />
      )}

      {stage === 'ready' ? (
        <>
          <nav aria-label="Product areas">
            <ul className="tabs">
              {productSections.map((entry) => (
                <li key={entry.id}>
                  <button
                    aria-current={section === entry.id ? 'page' : undefined}
                    data-testid={`nav-${entry.id}`}
                    onClick={() => {
                      setSection(entry.id);
                    }}
                    type="button"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <ProductSection
            account={account}
            api={api}
            onSessionEnded={onSessionEnded}
            section={section}
          />
        </>
      ) : null}
    </>
  );
}

function ProductSection({
  account,
  api,
  onSessionEnded,
  section,
}: {
  readonly account: AccountState;
  readonly api: ConsumerApi;
  readonly onSessionEnded: () => void;
  readonly section: SectionId;
}): ReactNode {
  switch (section) {
    case 'discovery': {
      return <DiscoveryPanel api={api} />;
    }
    case 'introductions': {
      return <IntroductionsPanel api={api} />;
    }
    case 'conversations': {
      return <ConversationsPanel api={api} />;
    }
    case 'calls': {
      return <CallsPanel api={api} />;
    }
    case 'notifications': {
      return <NotificationsPanel api={api} />;
    }
    case 'memberships': {
      return <Memberships api={api} onSessionEnded={onSessionEnded} />;
    }
    case 'profile': {
      return (
        <>
          <ProfilePanel account={account} api={api} />
          <AvailabilityPanel api={api} />
        </>
      );
    }
    default: {
      return <SafetyPanel api={api} />;
    }
  }
}
