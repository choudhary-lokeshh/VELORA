'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSession } from './providers';
import { AdminShell } from './shell';

/**
 * Who may see what, decided from server answers only.
 *
 * One question, asked once: does the server say this browser holds a Platform
 * Admin session at phishing-resistant assurance. Nothing here re-derives that —
 * it reads the audience and the assurance the session endpoint published — and
 * nothing here grants it. A gate is not a security boundary and is not treated
 * as one: every request behind it is authorized again by the server, and a
 * refusal is rendered as a refusal.
 *
 * Today the answer is always no, everywhere. No route in the contract can issue
 * a Platform Admin session — `/v1/auth/local/web-sessions` admits only the two
 * consumer-facing audiences — and no phishing-resistant verifier is approved,
 * so an operator lands on the access page and stays there. That is the truth
 * rather than a defect, and the access page says so in those terms instead of
 * leaving somebody on a console that answers nothing.
 */

/**
 * The moment before anybody knows what this browser holds.
 *
 * The page is delivered before the session answer exists, so this state is real
 * and has a duration. Rendering the console into it would put a privileged
 * layout in front of somebody who has no privilege, and rendering the access
 * page would flash a refusal at an operator who has not been refused.
 */
export function Bootstrap() {
  return (
    <div className="a-bootstrap" data-testid="bootstrap">
      <p aria-live="polite" className="a-bootstrap__mark" role="status">
        VELORA
      </p>
      <p className="a-visually-hidden">Loading Platform Admin</p>
    </div>
  );
}

/**
 * Pages behind a live, privileged session.
 *
 * Somebody without one is sent to the access page carrying where they were
 * going. `docs/surfaces/04-platform-admin.md` is explicit that link possession
 * grants no access and that session, role, scope, target, feature phase, and
 * current state are rechecked — so the destination travels as a same-origin
 * path, is validated again before it is followed, and buys nothing on its own.
 */
export function AdminGate({
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

  useEffect(() => {
    if (session.known && !session.privileged) {
      router.replace(`/access?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router, session.known, session.privileged]);

  // Everything that is not a privileged session — no session, the wrong
  // audience, stale assurance, or a platform that could not be asked — leads to
  // the same place, because the access page is where all four are explained and
  // three of them are indistinguishable from here anyway.
  if (!session.known || !session.privileged) return <Bootstrap />;

  return (
    <AdminShell narrow={narrow} title={title}>
      {children}
    </AdminShell>
  );
}
