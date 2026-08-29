'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';

import {
  BlockedState,
  Button,
  ErrorMessage,
  ErrorState,
  Fact,
  Facts,
  Field,
  Notice,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  TextInput,
} from '../design/primitives';
import { failureMessage } from '../api/messages';
import { homePath, safeReturnPath } from '../app/navigation';
import { useApi, useSession } from '../app/providers';
import { DoorLayout } from '../app/shell';
import { humanState } from './format';

/**
 * Local development only: establishes a platform_admin session using the
 * deterministic local-test adapter (ADR-0034). Never rendered in staging
 * or production.
 */
function LocalDevSignIn() {
  const api = useApi();
  const session = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subject, setSubject] = useState('admin@velora.test');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await api.createLocalAdminSession({ subject });
      if (result.kind === 'ok') {
        session.refresh();
        // The same guard the gate uses when it records where somebody was
        // going. Written once, so an address this console will follow after
        // authentication cannot be judged safe by one rule and unsafe by
        // another.
        router.push(safeReturnPath(searchParams.get('next')) ?? homePath);
      } else {
        setError(
          failureMessage(result) ??
            'Authentication was refused by the platform.',
        );
      }
    } catch {
      setError('Could not connect to the API.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel testId="local-dev-signin">
      <PanelHead
        lede="Deterministic local-test adapter for development and manual verification (ADR-0034)."
        title="Local Development Access"
      />
      <PanelBody>
        <Notice
          icon="alert"
          testId="local-dev-notice"
          title="Development only"
          tone="caution"
        >
          This sign-in panel is available only in local and test environments.
          Staging and production fail-closed because no real WebAuthn provider
          is approved.
        </Notice>
        <form
          className="a-stack a-stack--3"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          style={{ marginTop: 'var(--space-3)' }}
        >
          <Field
            error={error}
            hint="An arbitrary identity subject (e.g. admin@velora.test) used by the local identity provider."
            label="Admin identity subject"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="local-admin-subject-input"
                disabled={submitting}
                onChange={(e) => {
                  setSubject(e.target.value);
                }}
                placeholder="admin@velora.test"
                required
                type="text"
                value={subject}
              />
            )}
          </Field>
          {error !== undefined ? (
            <ErrorMessage testId="local-admin-error">{error}</ErrorMessage>
          ) : null}
          <Button
            busy={submitting}
            data-testid="local-admin-submit"
            icon="check"
            tone="primary"
            type="submit"
          >
            Sign in as Local Platform Admin
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

/**
 * The door, and the only address on this surface anybody currently reaches.
 *
 * Platform Admin requires a session whose audience is `platform_admin` and
 * whose authenticator is phishing-resistant and recently used. [ADR-0017]
 * fixes both, and in deployed environments neither is obtainable.
 *
 * In local development (ADR-0034), a deterministic test adapter allows
 * issuing a `platform_admin` session with `phishing_resistant` assurance
 * for developer testing.
 */
export function Access() {
  const session = useSession();
  const holds = session.session.value;
  const isLocalEnv =
    session.appEnvironment === 'local' || session.appEnvironment === 'test';

  return (
    <DoorLayout>
      <div className="a-stack a-stack--2">
        <h1 className="a-title">Platform Admin</h1>
        <p className="a-small a-muted">
          The privileged operations console. Everything behind this page acts on
          somebody else's account, money, or content, so reaching it takes more
          than being signed in.
        </p>
      </div>

      {isLocalEnv ? <LocalDevSignIn /> : null}

      <BlockedState
        label="Production Gate"
        testId="access-blocked"
        title="No production session can hold privileged access"
      >
        <p>
          Two conditions have to be true at once, and they are checked
          separately because they fail for different reasons.
        </p>
        <ul className="a-door-list">
          <li>
            The session's audience must be <strong>Platform Admin</strong>. The
            authentication contract admits only the consumer and Creator Studio
            audiences in production.
          </li>
          <li>
            Its authenticator must be <strong>phishing-resistant</strong> and
            recently used. VELORA composes a verifier that refuses every
            assertion in production, because no phishing-resistant
            implementation is approved and hand-rolling one would be a
            fabricated control.
          </li>
        </ul>
        <p>
          Neither is a fault in this console and neither is something an
          operator can work around. Both are recorded as open decisions rather
          than as defects.
        </p>
      </BlockedState>

      <Panel testId="access-session">
        <PanelHead
          lede="What the server says this browser is holding right now."
          title="This session"
        />
        <PanelBody>
          {!session.known ? (
            <PanelSkeleton rows={2} />
          ) : !session.answered ? (
            /*
             * The platform could not be asked. Saying "you hold no session"
             * here would be stating something this console does not know — and
             * it is the likeliest state on this origin, because a deployment
             * that has not allowed the console's origin refuses the request
             * before it arrives.
             */
            <ErrorState
              body={
                session.session.error ??
                'The platform could not be asked what this browser holds.'
              }
              onRetry={session.refresh}
              testId="access-unreachable"
              title="This console could not reach the platform"
            />
          ) : holds === undefined ? (
            <p className="a-small a-muted" data-testid="access-no-session">
              This browser holds no session at all.
            </p>
          ) : (
            <>
              <Facts>
                <Fact
                  term="Audience"
                  testId="access-audience"
                  value={
                    <span className="a-mono">{humanState(holds.audience)}</span>
                  }
                />
                <Fact
                  term="Assurance"
                  testId="access-assurance"
                  value={
                    <span className="a-mono">
                      {humanState(holds.assurance)}
                    </span>
                  }
                />
              </Facts>
              <p className="a-caption a-quiet">
                A session for another audience is refused at every privileged
                route before any lookup happens on its behalf. Signing out here
                does not sign you out of that surface.
              </p>
              <Button
                busy={session.busy}
                data-testid="access-sign-out"
                icon="logOut"
                onClick={session.signOut}
              >
                Sign this session out
              </Button>
            </>
          )}
        </PanelBody>
      </Panel>

      <p className="a-caption a-quiet">
        Recorded in the platform's open decisions as a privileged-authenticator
        provider choice and an approval policy, both outstanding.
      </p>
    </DoorLayout>
  );
}
