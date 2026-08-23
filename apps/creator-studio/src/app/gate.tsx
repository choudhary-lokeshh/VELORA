'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '../design/primitives';
import { safeReturnPath } from './navigation';
import { useCreator, useSession } from './providers';
import { StudioShell } from './shell';

/**
 * Who may see what, decided from server answers only.
 *
 * Two questions in order, and each one has to be answered before the next is
 * meaningful: is there a Creator Studio session, and has the server finished
 * admitting this creator. Nothing here re-derives the activation ladder —
 * `creatorStage` reads the step the server published — because a client that
 * computed its own would eventually disagree with the server about who may
 * operate.
 *
 * A gate is not a security boundary and is not treated as one. Every request
 * behind it is authorized again by the server; this only decides what is worth
 * putting in front of somebody.
 */

/**
 * The moment before anybody knows whose workspace this is.
 *
 * The page is delivered before the session answer exists, so this state is real
 * and has a duration. Rendering the signed-out page in that window would put a
 * sign-in form in front of somebody who is already signed in, and rendering the
 * workspace would flash a creator's business at somebody who is not them.
 */
export function Bootstrap() {
  return (
    <div className="s-bootstrap" data-testid="bootstrap">
      <p aria-live="polite" className="s-bootstrap__mark" role="status">
        VELORA
      </p>
      <p className="s-visually-hidden">Loading Creator Studio</p>
    </div>
  );
}

/**
 * Pages behind a live session and an activated creator capability.
 *
 * Somebody who is not signed in is sent to sign in, carrying where they were
 * going. `docs/surfaces/03-creator-studio.md` requires a deep link to validate
 * creator scope and session before it is followed, so the destination travels as
 * a same-origin path and is validated again before it is used.
 */
export function StudioGate({
  children,
  narrow = false,
  title,
}: {
  readonly children: ReactNode;
  readonly narrow?: boolean;
  readonly title: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const creator = useCreator();

  const activated = creator.onboarding.value?.step === 'completed';
  const needsActivation =
    session.signedIn &&
    creator.settled &&
    creator.onboarding.error === undefined &&
    !activated;

  useEffect(() => {
    if (session.known && !session.signedIn) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (needsActivation) router.replace('/start');
  }, [needsActivation, pathname, router, session.known, session.signedIn]);

  if (!session.known || !session.signedIn) return <Bootstrap />;

  // A failed read is the same thing to somebody standing here: the surface
  // cannot tell whether they may operate. Reporting it is the only honest
  // answer — waiting for an answer that already failed would leave them on a
  // loading screen with no end.
  const failure = creator.onboarding.error;
  if (failure !== undefined) {
    return (
      <StudioShell narrow={narrow} title={title}>
        <ErrorState
          body={failure}
          onRetry={creator.onboarding.retryable ? creator.reloadAll : undefined}
          testId="creator-status-failed"
          title="We could not load your creator account"
        />
      </StudioShell>
    );
  }

  if (!activated) return <Bootstrap />;

  return (
    <StudioShell narrow={narrow} title={title}>
      {children}
    </StudioShell>
  );
}

/**
 * Pages that only make sense when nobody is signed in.
 *
 * Somebody with a live session landing on the sign-in page is sent into the
 * workspace rather than shown a door they are already through.
 */
export function PublicGate({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const parameters = useSearchParams();
  const requested = safeReturnPath(parameters.get('next'));

  useEffect(() => {
    if (session.signedIn) router.replace(requested ?? '/home');
  }, [requested, router, session.signedIn]);

  if (!session.known || session.signedIn) return <Bootstrap />;
  return <>{children}</>;
}

/**
 * The activation ladder itself.
 *
 * Reachable only with a session, and left as soon as the server says the
 * capability is active. Somebody who finishes on another device and comes back
 * to this tab is moved on when the tab next asks, rather than being asked to
 * repeat a step they already completed.
 */
export function ActivationGate({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const creator = useCreator();

  const activated = creator.onboarding.value?.step === 'completed';

  useEffect(() => {
    if (session.known && !session.signedIn) {
      router.replace('/sign-in?next=%2Fstart');
      return;
    }
    if (activated) router.replace('/home');
  }, [activated, router, session.known, session.signedIn]);

  if (!session.known || !session.signedIn || activated) return <Bootstrap />;
  return <>{children}</>;
}
