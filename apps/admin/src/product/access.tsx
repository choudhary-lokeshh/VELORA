'use client';

import {
  BlockedState,
  Button,
  ErrorState,
  Fact,
  Facts,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
} from '../design/primitives';
import { useSession } from '../app/providers';
import { DoorLayout } from '../app/shell';
import { humanState } from './format';

/**
 * The door, and the only address on this surface anybody currently reaches.
 *
 * Platform Admin requires a session whose audience is `platform_admin` and
 * whose authenticator is phishing-resistant and recently used. [ADR-0017]
 * fixes both, and neither is obtainable: the authentication contract admits
 * only the two consumer-facing audiences, and the one privileged verifier the
 * platform composes refuses every assertion because no implementation is
 * approved. There is therefore no environment — local, test, staging, or
 * production — in which an operator can reach the console behind this page.
 *
 * What this page does about that is the whole design. It reports what the
 * browser actually holds, in the server's own words; it states both conditions
 * separately, because an operator whose audience is wrong and one whose
 * assurance is stale have different problems; and it offers **no sign-in form**,
 * because no route would accept one and a form that always fails is worse than
 * an explanation. The one control it does offer is signing out, which is real:
 * somebody may be carrying a consumer session on this origin and be better off
 * without it.
 */
export function Access() {
  const session = useSession();
  const holds = session.session.value;

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

      <BlockedState
        label="Unreachable"
        testId="access-blocked"
        title="No session can hold privileged access"
      >
        <p>
          Two conditions have to be true at once, and they are checked
          separately because they fail for different reasons.
        </p>
        <ul className="a-door-list">
          <li>
            The session's audience must be <strong>Platform Admin</strong>. The
            authentication contract admits only the consumer and Creator Studio
            audiences, so no route can issue one.
          </li>
          <li>
            Its authenticator must be <strong>phishing-resistant</strong> and
            recently used. VELORA composes a verifier that refuses every
            assertion, because no phishing-resistant implementation is approved
            and hand-rolling one would be a fabricated control.
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
              This browser holds no session at all. That is the ordinary state
              for this origin: nothing signs in here.
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
