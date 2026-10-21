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
import { useApi, useOperator, useSession } from '../app/providers';
import { DoorLayout } from '../app/shell';
import { humanState } from './format';
import { assertAuthenticator, enrolAuthenticator } from './webauthn';

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
 * Sign in through the platform's identity provider.
 *
 * The console never sees a credential. It asks the platform to open an attempt,
 * the platform commits the single-use state for it and answers with an address,
 * and the browser goes there. What comes back arrives as a cookie on the API's
 * own origin, so nothing in this file ever holds a token.
 */
function FederatedSignIn() {
  const api = useApi();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const refused = searchParams.get('velora_auth') === 'refused';

  const handleSignIn = async () => {
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const returnTo = safeReturnPath(searchParams.get('next'));
      const result = await api.createFederatedAuthorization({
        audience: 'platform_admin',
        ...(returnTo === undefined ? {} : { returnTo }),
      });
      if (result.kind === 'ok') {
        window.location.assign(result.value.authorizationUrl);
        return;
      }
      setError(
        failureMessage(result) ??
          'This deployment has no identity provider configured, so there is nowhere to send you.',
      );
    } catch {
      setError('Could not connect to the API.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel testId="federated-signin">
      <PanelHead
        lede="The platform sends you to its identity provider and believes only what that provider signed."
        title="Sign in"
      />
      <PanelBody>
        {refused ? (
          <Notice
            icon="alert"
            testId="federated-refused"
            title="That sign-in did not complete"
            tone="caution"
          >
            The attempt was refused, expired, or was declined. Nothing about
            which is disclosed, deliberately. Starting again is safe.
          </Notice>
        ) : null}
        {error !== undefined ? (
          <ErrorMessage testId="federated-error">{error}</ErrorMessage>
        ) : null}
        <Button
          busy={submitting}
          data-testid="federated-submit"
          icon="check"
          onClick={() => {
            void handleSignIn();
          }}
          tone="primary"
        >
          Continue to the identity provider
        </Button>
      </PanelBody>
    </Panel>
  );
}

/**
 * Enrol a phishing-resistant authenticator.
 *
 * Reachable to any Platform Admin session, deliberately, and not only to one
 * that already stepped up: a first enrolment is how an operator reaches
 * phishing-resistant assurance in the first place, so requiring it here would
 * close the only door to itself. A second key is different. The server refuses
 * it until the operator has stepped up with a key they already hold, and that
 * refusal arrives here as the ordinary privileged refusal. The server still
 * consumes a challenge it issued to this operator and verifies the
 * registration against it.
 */
function PrivilegedEnrolment({ accountId }: { readonly accountId: string }) {
  const api = useApi();
  const session = useSession();
  const [label, setLabel] = useState('Security key');
  const [error, setError] = useState<string | undefined>(undefined);
  const [enrolled, setEnrolled] = useState<
    { readonly count: number; readonly ready: boolean } | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleEnrol = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const challenge = await api.createPrivilegedChallenge({
        purpose: 'enrolment',
      });
      if (challenge.kind !== 'ok') {
        setError(
          failureMessage(challenge) ??
            'This deployment has no phishing-resistant verifier configured.',
        );
        return;
      }
      const ceremony = await enrolAuthenticator({
        accountId,
        challenge: challenge.value.challenge,
        label,
        relyingPartyId: challenge.value.relyingPartyId,
      });
      if (ceremony.kind === 'unsupported') {
        setError('This browser has no WebAuthn support.');
        return;
      }
      if (ceremony.kind === 'refused') {
        setError(ceremony.reason);
        return;
      }
      const stored = await api.enrolPrivilegedAuthenticator(ceremony.value);
      if (stored.kind !== 'ok') {
        setError(
          failureMessage(stored) ??
            'The platform did not accept this authenticator.',
        );
        return;
      }
      setEnrolled({ count: stored.value.enrolled, ready: stored.value.ready });
      session.refresh();
    } catch {
      setError('Could not connect to the API.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel testId="privileged-enrolment">
      <PanelHead
        lede="A key, a passkey, or a platform authenticator. Two are required before production privileged access."
        title="Enrol an authenticator"
      />
      <PanelBody>
        <form
          className="a-stack a-stack--3"
          onSubmit={(event) => {
            void handleEnrol(event);
          }}
        >
          <Field
            hint="Only you see this. It exists so a lost key can be revoked by name."
            label="What to call this authenticator"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="enrolment-label-input"
                disabled={submitting}
                maxLength={64}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
                required
                type="text"
                value={label}
              />
            )}
          </Field>
          {error !== undefined ? (
            <ErrorMessage testId="enrolment-error">{error}</ErrorMessage>
          ) : null}
          {enrolled !== undefined ? (
            <Notice
              icon="check"
              testId="enrolment-result"
              title={
                enrolled.ready
                  ? 'Enrolled, and this operator now holds enough'
                  : 'Enrolled'
              }
              tone="info"
            >
              {enrolled.count} live authenticator
              {enrolled.count === 1 ? '' : 's'}.{' '}
              {enrolled.ready
                ? 'ADR-0017 asks for two independently stored ones, and that is satisfied.'
                : 'ADR-0017 asks for two independently stored ones, so step up with this one, then enrol another on a different device.'}
            </Notice>
          ) : null}
          <Button
            busy={submitting}
            data-testid="enrolment-submit"
            icon="check"
            type="submit"
          >
            Enrol this device
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

/**
 * Step up to phishing-resistant assurance.
 *
 * Every privileged route checks the assurance this refreshes *and its age*, so
 * this is the control an operator returns to rather than one they press once.
 */
function PrivilegedStepUp() {
  const api = useApi();
  const session = useSession();
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleStepUp = async () => {
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const challenge = await api.createPrivilegedChallenge({
        purpose: 'assertion',
      });
      if (challenge.kind !== 'ok') {
        setError(
          failureMessage(challenge) ??
            'This deployment has no phishing-resistant verifier configured.',
        );
        return;
      }
      if (challenge.value.credentialIds.length === 0) {
        setError('This operator holds no enrolled authenticator yet.');
        return;
      }
      const ceremony = await assertAuthenticator({
        challenge: challenge.value.challenge,
        credentialIds: challenge.value.credentialIds,
        relyingPartyId: challenge.value.relyingPartyId,
      });
      if (ceremony.kind === 'unsupported') {
        setError('This browser has no WebAuthn support.');
        return;
      }
      if (ceremony.kind === 'refused') {
        setError(ceremony.reason);
        return;
      }
      const stepped = await api.stepUpPrivilegedSession(ceremony.value);
      if (stepped.kind !== 'ok') {
        setError(failureMessage(stepped) ?? 'The assertion was not accepted.');
        return;
      }
      session.refresh();
    } catch {
      setError('Could not connect to the API.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel testId="privileged-step-up">
      <PanelHead
        lede="Privileged access expires on its own. Presenting your authenticator again is how it comes back."
        title="Present your authenticator"
      />
      <PanelBody>
        {error !== undefined ? (
          <ErrorMessage testId="step-up-error">{error}</ErrorMessage>
        ) : null}
        <Button
          busy={submitting}
          data-testid="step-up-submit"
          icon="check"
          onClick={() => {
            void handleStepUp();
          }}
          tone="primary"
        >
          Present authenticator
        </Button>
      </PanelBody>
    </Panel>
  );
}

/**
 * The first operator grant.
 *
 * Shown only to a session that is already privileged and holds no role, which
 * is the exact and short-lived state a fresh deployment is in. Three things
 * have to be true and this form supplies one of them; the other two are the
 * session you are already holding.
 */
function FirstOperatorBootstrap() {
  const api = useApi();
  const operator = useOperator();
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [granted, setGranted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleBootstrap = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await api.bootstrapFirstOperator({ reason, token });
      if (result.kind === 'ok') {
        setGranted(true);
        setToken('');
        operator.refresh();
        return;
      }
      setError(
        failureMessage(result) ??
          'The first grant was refused. The answer never says which condition failed.',
      );
    } catch {
      setError('Could not connect to the API.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel testId="operator-bootstrap">
      <PanelHead
        lede="A deployment where nobody holds a grant has nobody who can issue one. This is the way out, and it works once."
        title="First operator"
      />
      <PanelBody>
        <Notice
          icon="alert"
          testId="operator-bootstrap-notice"
          title="Remove the secret afterwards"
          tone="caution"
        >
          The bootstrap secret comes from this deployment's secret manager. Once
          this succeeds it can never be used again, and the value should be
          removed from the secret manager rather than left in it.
        </Notice>
        <form
          className="a-stack a-stack--3"
          onSubmit={(event) => {
            void handleBootstrap(event);
          }}
          style={{ marginTop: 'var(--space-3)' }}
        >
          <Field
            hint="ADMIN_OPERATOR_BOOTSTRAP_TOKEN, as this environment was deployed with."
            label="Bootstrap secret"
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                data-testid="operator-bootstrap-token"
                disabled={submitting}
                onChange={(event) => {
                  setToken(event.target.value);
                }}
                required
                type="password"
                value={token}
              />
            )}
          </Field>
          <Field
            hint="Recorded on the operator audit beside the grant."
            label="Why this operator"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="operator-bootstrap-reason"
                disabled={submitting}
                maxLength={280}
                minLength={8}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                required
                type="text"
                value={reason}
              />
            )}
          </Field>
          {error !== undefined ? (
            <ErrorMessage testId="operator-bootstrap-error">
              {error}
            </ErrorMessage>
          ) : null}
          {granted ? (
            <Notice
              icon="check"
              testId="operator-bootstrap-result"
              title="Granted"
              tone="info"
            >
              This operator now holds a super administrator role, and the
              bootstrap is consumed for the life of this deployment.
            </Notice>
          ) : null}
          <Button
            busy={submitting}
            data-testid="operator-bootstrap-submit"
            icon="check"
            tone="primary"
            type="submit"
          >
            Take the first grant
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
  const operator = useOperator();
  const holds = session.session.value;
  const isLocalEnv =
    session.appEnvironment === 'local' || session.appEnvironment === 'test';
  const isPlatformAdmin = holds?.audience === 'platform_admin';
  const needsBootstrap =
    session.privileged && operator.known && operator.role === undefined;

  return (
    <DoorLayout>
      <div className="a-stack a-stack--2">
        <h1 className="a-title">Platform Admin</h1>
        <p className="a-small a-muted">
          The privileged operations console. Everything behind this page acts on
          somebody else&apos;s account, money, or content, so reaching it takes
          more than being signed in.
        </p>
      </div>

      {holds === undefined ? (
        isLocalEnv ? (
          <LocalDevSignIn />
        ) : (
          <FederatedSignIn />
        )
      ) : null}

      {isPlatformAdmin ? (
        <>
          <PrivilegedStepUp />
          <PrivilegedEnrolment accountId={holds.accountId} />
        </>
      ) : null}

      {needsBootstrap ? <FirstOperatorBootstrap /> : null}

      <BlockedState
        label="What privileged access requires"
        testId="access-blocked"
        title="Two conditions, checked separately because they fail for different reasons"
      >
        <ul className="a-door-list">
          <li>
            The session&apos;s audience must be <strong>Platform Admin</strong>.
            That comes from signing in through this console&apos;s own origin,
            which the platform checks against its allowlist before it will open
            an attempt at all.
          </li>
          <li>
            Its authenticator must be <strong>phishing-resistant</strong> and
            recently used. Presenting one refreshes an assurance that expires on
            its own, so a console left open stops being privileged without
            anybody doing anything.
          </li>
        </ul>
        <p>
          Holding both is still not permission. Every route names the one
          capability that authorises it and the server checks it, so an operator
          with no grant may look at nothing and do nothing.
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
                <Fact
                  term="Role"
                  testId="access-role"
                  value={
                    <span className="a-mono">
                      {operator.role === undefined
                        ? 'none granted'
                        : humanState(operator.role)}
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
        Which authenticator an operator must hold, and how a lost one is
        recovered, remain open decisions. The verification itself is ADR-0049.
      </p>
    </DoorLayout>
  );
}
