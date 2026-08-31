'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { journeyStage } from '@velora/consumer-client';

import { Button, EmptyState } from '../design/primitives';
import { AppShell } from './shell';
import { returnParameter, safeReturnPath, signInHref } from './navigation';
import { useAccount, useSession } from './providers';

/**
 * Who may see what, decided from server answers only.
 *
 * Three questions in order, and each one has to be answered before the next is
 * meaningful: is there a session, does an account exist, and has the server
 * admitted it. Nothing here re-derives the admission ladder — `journeyStage`
 * reads the step the server published — because a client that computed its own
 * would eventually disagree with the server about who may be seen.
 *
 * A gate is not a security boundary and is not treated as one. Every request
 * behind it is authorized again by the server; this only decides what is worth
 * putting in front of somebody.
 */

/**
 * The moment before anybody knows whose page this is.
 *
 * The page is delivered before the session answer exists, so this state is real
 * and has a duration. Rendering the signed-out page in that window would put a
 * sign-in form in front of somebody who is already signed in, and rendering the
 * product would flash content at somebody who is not.
 */
export function Bootstrap({ label = 'VELORA' }: { readonly label?: string }) {
  return (
    <div className="v-bootstrap" data-testid="bootstrap">
      <p aria-live="polite" className="v-bootstrap__mark" role="status">
        {label}
      </p>
      <p className="v-visually-hidden">Loading VELORA</p>
    </div>
  );
}

/**
 * Pages behind a live, admitted session.
 *
 * A person who is not signed in is sent to sign in, carrying where they were
 * going. `docs/surfaces/01-consumer-web.md` requires an intended destination to
 * be restored only after authentication, so the destination travels as a
 * same-origin path and is validated again before it is followed.
 */
export function AppGate({
  children,
  immersive = false,
  narrow = false,
  title,
}: {
  readonly children: ReactNode;
  /** Settings-shaped pages read better at a bounded measure than at full width. */
  /** Handed to the shell: a page whose subject is a picture, not a column. */
  readonly immersive?: boolean;
  readonly narrow?: boolean;
  readonly title: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const account = useAccount();

  const admitted =
    account.settled &&
    account.account.value !== undefined &&
    journeyStage(account.onboarding.value) === 'ready';
  const needsWelcome =
    session.signedIn &&
    account.settled &&
    account.account.error === undefined &&
    account.onboarding.error === undefined &&
    !admitted;

  useEffect(() => {
    if (session.known && !session.signedIn) {
      router.replace(signInHref(pathname));
      return;
    }
    if (needsWelcome) router.replace('/welcome');
  }, [needsWelcome, pathname, router, session.known, session.signedIn]);

  if (!session.known || !session.signedIn) return <Bootstrap />;

  // Either read failing is the same thing to somebody standing here: the
  // surface cannot tell whether they are admitted. Reporting it is the only
  // honest answer — waiting for an answer that already failed would leave them
  // on a loading screen with no end.
  const failure = account.account.error ?? account.onboarding.error;
  if (failure !== undefined) {
    return (
      <AppShell immersive={immersive} narrow={narrow} title={title}>
        <EmptyState
          actions={
            <Button onClick={account.reloadAll} tone="primary">
              Try again
            </Button>
          }
          body={failure}
          icon="refresh"
          testId="account-failed"
          title="We could not load your account"
        />
      </AppShell>
    );
  }

  if (!admitted) return <Bootstrap />;

  return (
    <AppShell immersive={immersive} narrow={narrow} title={title}>
      {children}
    </AppShell>
  );
}

/**
 * Pages that only make sense when nobody is signed in.
 *
 * Somebody with a live session landing on the entry page is sent into the
 * product rather than shown a door they are already through — and into Live,
 * which is the primary destination, unless they arrived following a link
 * somewhere else.
 */
export function PublicGate({
  children,
  redirectTo = '/live',
}: {
  readonly children: ReactNode;
  readonly redirectTo?: string;
}) {
  const router = useRouter();
  const session = useSession();
  const parameters = useSearchParams();
  const requested = safeReturnPath(parameters.get(returnParameter));

  useEffect(() => {
    if (session.signedIn) router.replace(requested ?? redirectTo);
  }, [redirectTo, requested, router, session.signedIn]);

  if (!session.known || session.signedIn) return <Bootstrap />;
  return <>{children}</>;
}

/**
 * The admission ladder itself.
 *
 * Reachable only with a session, and left as soon as the server says the
 * account is admitted. Somebody who finishes on another device and comes back
 * to this tab is moved on when the tab next asks, rather than being asked to
 * repeat a step they already completed.
 */
export function WelcomeGate({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const account = useAccount();

  const ready =
    account.settled &&
    account.account.value !== undefined &&
    journeyStage(account.onboarding.value) === 'ready';

  useEffect(() => {
    if (session.known && !session.signedIn) {
      router.replace(signInHref('/welcome'));
      return;
    }
    if (ready) router.replace('/live');
  }, [ready, router, session.known, session.signedIn]);

  if (!session.known || !session.signedIn || ready) return <Bootstrap />;
  return <>{children}</>;
}
