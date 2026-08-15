'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import type {
  CreatorApi,
  CreatorOnboardingState,
  CreatorProfile,
} from '@velora/creator-client';
import {
  creatorAdultGateMessages,
  creatorStage,
  creatorStageLabels,
  creatorStanding,
  creatorStandingLabels,
  failureMessage,
  publicationLabels,
  publicationView,
} from '@velora/creator-client';

import { createCreatorStudioAuthClient } from '../auth/client';
import {
  creatorAuthCauseMessages,
  creatorAuthMessages,
  initialCreatorAuthState,
  reduceCreatorAuth,
} from '../auth/state';
import { createStudioCreatorApi } from './api';
import { ClubsPanel } from './clubs';
import { ContentPanel } from './content';
import { Dashboard } from './dashboard';
import { Earnings } from './earnings';
import { Offers } from './offers';
import { Payouts } from './payouts';
import { useResource, useRevalidateOnFocus, useSingleFlight } from './resource';
import { ErrorMessage, ResourceState, Section, StatusMessage } from './ui';

/**
 * Creator Studio's product root.
 *
 * It owns two things and delegates everything else: whether there is a live
 * Creator Studio session, and where the server says this creator stands on the
 * activation ladder. No screen below decides whether an action is allowed,
 * because none of them can — the server decides, and a refusal is rendered as a
 * refusal rather than reconciled against whatever this tab last believed.
 *
 * Nothing here shows a number the platform did not compute, a price, or a
 * control implying somebody can pay for something. No payment path exists, so
 * offering one would be a lie in a button.
 */

export function CreatorStudio({
  apiBaseUrl,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the journey runs without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const authClient = useMemo(
    () =>
      createCreatorStudioAuthClient({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    [apiBaseUrl, fetchImplementation],
  );
  const api = useMemo<CreatorApi>(
    () =>
      createStudioCreatorApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
      }),
    [apiBaseUrl, fetchImplementation],
  );

  const [auth, dispatch] = useReducer(
    reduceCreatorAuth,
    initialCreatorAuthState,
  );
  const [subject, setSubject] = useState('creator@velora.test');
  const { busy, run: runAuth } = useSingleFlight();

  const checkSession = useCallback(() => {
    void authClient.session().then((outcome) => {
      dispatch({ outcome, type: 'session-result' });
    });
  }, [authClient]);

  useEffect(checkSession, [checkSession]);
  // A session can end in another tab, on another device, or by expiring. Studio
  // sessions are shorter than consumer ones, so this matters more here.
  useRevalidateOnFocus(checkSession);

  const signedIn = auth.status === 'authenticated';
  const sessionKnown = auth.status !== 'loading';

  return (
    <div className="shell">
      <header>
        <p className="wordmark">VELORA</p>
        <h1>Creator Studio</h1>
      </header>
      <main>
        <Section headingId="session-heading" title="Session">
          <StatusMessage testId="auth-status">
            {creatorAuthMessages[auth.status]}
          </StatusMessage>
          {auth.status === 'unauthenticated' ? (
            <p data-testid="auth-cause">
              {creatorAuthCauseMessages[auth.cause]}
            </p>
          ) : null}
          {auth.status === 'rejected' ? (
            <ErrorMessage testId="auth-rejected">
              Sign-in was refused.
            </ErrorMessage>
          ) : null}

          {signedIn ? (
            <button
              data-testid="auth-sign-out"
              disabled={busy}
              onClick={() => {
                runAuth(async () => {
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
          ) : null}

          {/*
            Nothing is offered until the session check has answered. A sign-in
            form in markup delivered before anybody knows whose it is would be a
            control that is visible and pressable while nothing is listening.
          */}
          {!signedIn && sessionKnown ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runAuth(async () => {
                  dispatch({
                    outcome: await authClient.signIn(subject),
                    type: 'sign-in-result',
                  });
                });
              }}
            >
              <label htmlFor="creator-subject">Development identity</label>
              <input
                id="creator-subject"
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
                value={subject}
              />
              <button data-testid="auth-sign-in" disabled={busy} type="submit">
                Sign in
              </button>
            </form>
          ) : null}
        </Section>

        {signedIn ? <SignedIn api={api} onSessionEnded={checkSession} /> : null}
      </main>
    </div>
  );
}

const studioAreas = [
  { id: 'home', label: 'Home' },
  { id: 'profile', label: 'Public profile' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'clubs', label: 'Private clubs' },
  { id: 'selling', label: 'Selling' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'payouts', label: 'Payouts' },
] as const;

type AreaId = (typeof studioAreas)[number]['id'];

function SignedIn({
  api,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly onSessionEnded: () => void;
}) {
  const loadOnboarding = useCallback(async () => api.onboarding(), [api]);
  const loadProfile = useCallback(async () => api.profile(), [api]);

  const onboarding = useResource<CreatorOnboardingState>(loadOnboarding, {
    onUnauthenticated: onSessionEnded,
  });
  const profile = useResource<CreatorProfile>(loadProfile, {
    onUnauthenticated: onSessionEnded,
  });

  const reloadAll = useCallback(() => {
    onboarding.reload();
    profile.reload();
  }, [onboarding, profile]);

  const [area, setArea] = useState<AreaId>('home');
  const stage = creatorStage({
    onboarding: onboarding.value,
    profile: profile.value,
  });

  // A capability that does not exist yet is not a failure. The server answers
  // the same 404 it answers for a route that is not there, so this surface
  // reads "no capability" from the absence rather than from an error message.
  const capabilityMissing =
    onboarding.value === undefined && !onboarding.loading;

  return (
    <>
      <Section headingId="status-heading" title="Creator access">
        {onboarding.value === undefined ? (
          <ResourceState resource={onboarding} testId="creator-status" />
        ) : (
          <>
            <StatusMessage testId="creator-standing">
              {creatorStandingLabels[creatorStanding(onboarding.value.account)]}
            </StatusMessage>
            <p data-testid="creator-stage">{creatorStageLabels[stage]}</p>
          </>
        )}

        {capabilityMissing ? (
          <BecomeCreator api={api} onDone={reloadAll} />
        ) : null}

        {onboarding.value?.adultGateSatisfied === false ? (
          <StatusMessage testId="creator-adult-gate">
            {creatorAdultGateMessages[
              onboarding.value.adultGateReason ?? 'not_in_good_standing'
            ] ?? 'Creator access is not available for this account.'}
          </StatusMessage>
        ) : null}

        {onboarding.value?.step === 'policy_acknowledgement' ? (
          <AcceptPolicies
            api={api}
            documents={onboarding.value.outstandingPolicies}
            onDone={reloadAll}
          />
        ) : null}
      </Section>

      {onboarding.value?.step === 'completed' ? (
        <>
          {/*
            One workspace with peer areas rather than a stack, so a creator
            with a long catalog is not scrolling past it to reach a club. The
            navigation is real links to real state; nothing here is a
            decorative tab that renders the same thing.
          */}
          <nav aria-label="Creator Studio areas">
            <ul className="tabs">
              {studioAreas.map((entry) => (
                <li key={entry.id}>
                  <button
                    aria-current={entry.id === area ? 'page' : undefined}
                    data-testid={`nav-${entry.id}`}
                    onClick={() => {
                      setArea(entry.id);
                    }}
                    type="button"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {area === 'home' ? (
            <Dashboard
              api={api}
              onSessionEnded={onSessionEnded}
              profile={profile.value}
            />
          ) : null}
          {area === 'profile' ? (
            <ProfileEditor
              api={api}
              onSaved={reloadAll}
              profile={profile.value}
              state={profile}
            />
          ) : null}
          {/*
            Writes are offered only while the capability may actually operate.
            A suspended creator still sees their catalog — it is theirs — but is
            not handed controls the server would refuse.
          */}
          {area === 'catalog' ? (
            <ContentPanel
              api={api}
              editable={onboarding.value.account.status === 'active'}
              onSessionEnded={onSessionEnded}
            />
          ) : null}
          {area === 'clubs' ? (
            <ClubsPanel
              api={api}
              editable={onboarding.value.account.status === 'active'}
              onSessionEnded={onSessionEnded}
            />
          ) : null}
          {/*
            Earnings is a read of what the platform holds, so it is offered
            whatever the capability's current status is. A suspended creator is
            still owed whatever they were owed, and hiding the figure would not
            change the money.
          */}
          {area === 'selling' ? (
            <Offers api={api} onSessionEnded={onSessionEnded} />
          ) : null}
          {area === 'earnings' ? (
            <Earnings api={api} onSessionEnded={onSessionEnded} />
          ) : null}
          {area === 'payouts' ? (
            <Payouts api={api} onSessionEnded={onSessionEnded} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function BecomeCreator({
  api,
  onDone,
}: {
  readonly api: CreatorApi;
  readonly onDone: () => void;
}) {
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);

  return (
    <>
      {message === undefined ? null : (
        <ErrorMessage testId="creator-onboard-error">{message}</ErrorMessage>
      )}
      <p>
        Creator access is separate from your VELORA account and is never granted
        automatically.
      </p>
      <button
        data-testid="creator-onboard"
        disabled={busy}
        onClick={() => {
          run(async () => {
            setMessage(failureMessage(await api.createAccount()));
            onDone();
          });
        }}
        type="button"
      >
        Become a creator
      </button>
    </>
  );
}

function AcceptPolicies({
  api,
  documents,
  onDone,
}: {
  readonly api: CreatorApi;
  readonly documents: CreatorOnboardingState['outstandingPolicies'];
  readonly onDone: () => void;
}) {
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);

  return (
    <>
      {message === undefined ? null : (
        <ErrorMessage testId="creator-policy-error">{message}</ErrorMessage>
      )}
      <ul data-testid="creator-outstanding-policies">
        {documents.map((document) => (
          <li key={`${document.key}@${document.version}`}>{document.key}</li>
        ))}
      </ul>
      <button
        data-testid="creator-accept-policies"
        disabled={busy}
        onClick={() => {
          run(async () => {
            setMessage(
              failureMessage(await api.acknowledgePolicies(documents)),
            );
            onDone();
          });
        }}
        type="button"
      >
        Accept the creator policies
      </button>
    </>
  );
}

/**
 * The creator's public identity.
 *
 * The handle input disappears once a handle exists, because this milestone has
 * no rename: leaving an editable field that the server would refuse is a worse
 * answer than not offering it. Publishing is its own control, so saving never
 * puts anything on the public internet as a side effect.
 */
function ProfileEditor({
  api,
  onSaved,
  profile,
  state,
}: {
  readonly api: CreatorApi;
  readonly onSaved: () => void;
  readonly profile: CreatorProfile | undefined;
  readonly state: {
    readonly error: string | undefined;
    readonly loading: boolean;
  };
}) {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  // The server's values win whenever it answers. A local draft that survived a
  // reload would be a second opinion about what is stored.
  const loadedVersion = profile?.version;
  useEffect(() => {
    if (profile === undefined) return;
    setHandle(profile.handle);
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? '');
  }, [loadedVersion, profile]);

  const view = publicationView(profile);

  return (
    <Section headingId="profile-heading" title="Public profile">
      {state.loading && profile === undefined ? (
        <StatusMessage testId="creator-profile-loading">Loading…</StatusMessage>
      ) : null}
      {message === undefined ? null : (
        <ErrorMessage testId="creator-profile-error">{message}</ErrorMessage>
      )}

      <StatusMessage testId="creator-publication">
        {publicationLabels[view]}
      </StatusMessage>
      {profile === undefined ? null : (
        <p data-testid="creator-public-path">{profile.publicPath}</p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            const result = await api.saveProfile({
              ...(bio.length === 0 ? {} : { bio }),
              displayName,
              handle,
              ...(profile === undefined ? {} : { version: profile.version }),
            });
            setMessage(failureMessage(result));
            onSaved();
          });
        }}
      >
        {profile === undefined ? (
          <>
            <label htmlFor="creator-handle">Public handle</label>
            <input
              data-testid="creator-handle"
              id="creator-handle"
              onChange={(event) => {
                setHandle(event.target.value);
              }}
              value={handle}
            />
            <p>
              Your handle becomes your public address and cannot be changed yet.
            </p>
          </>
        ) : (
          <p data-testid="creator-handle-fixed">{profile.handle}</p>
        )}

        <label htmlFor="creator-display-name">Display name</label>
        <input
          data-testid="creator-display-name"
          id="creator-display-name"
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
          value={displayName}
        />

        <label htmlFor="creator-bio">Bio</label>
        <textarea
          data-testid="creator-bio"
          id="creator-bio"
          onChange={(event) => {
            setBio(event.target.value);
          }}
          value={bio}
        />

        <button
          data-testid="creator-save-profile"
          disabled={busy}
          type="submit"
        >
          Save profile
        </button>
      </form>

      {profile === undefined ? null : (
        <button
          data-testid="creator-toggle-publication"
          disabled={busy}
          onClick={() => {
            run(async () => {
              const result = await api.setPublication({
                publication:
                  profile.publication === 'published' ? 'draft' : 'published',
                version: profile.version,
              });
              setMessage(failureMessage(result));
              onSaved();
            });
          }}
          type="button"
        >
          {profile.publication === 'published'
            ? 'Unpublish this page'
            : 'Publish this page'}
        </button>
      )}
    </Section>
  );
}
