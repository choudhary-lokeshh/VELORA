'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon } from '../design/icons';
import { accessPath, destinations, isCurrent, parentOf } from './navigation';
import { useSession, useToast } from './providers';

/**
 * The console shell.
 *
 * One navigation model, three arrangements. Which one an operator gets is
 * decided by the width the work needs rather than by a device name: a bottom
 * bar below the tablet, a labelled rail from the tablet, a persistent sidebar
 * from the desktop.
 *
 * Both navigations are rendered and the stylesheet shows one, because choosing
 * in JavaScript would mean the first paint after hydration has the wrong one.
 *
 * Nothing in this shell counts anything. It would be easy to put a number on
 * Queues, and it would be a number read from a page of a paged list rather than
 * a total the platform computed — which on the surface where operators decide
 * what to work on next is exactly the wrong place to be approximately right.
 */
export function AdminShell({
  children,
  narrow = false,
  title,
}: {
  readonly children: ReactNode;
  /** Form-shaped pages read better at a bounded measure than at full width. */
  readonly narrow?: boolean;
  /** Shown in the phone header, where there is no room for a sidebar. */
  readonly title: string;
}) {
  const pathname = usePathname();
  const session = useSession();
  const parent = parentOf(pathname);

  return (
    <div className="a-shell">
      <a className="a-skip-link" href="#main">
        Skip to content
      </a>

      <nav aria-label="Console" className="a-sidebar">
        <Link className="a-sidebar__brand" href="/queues">
          <Icon name="sparkle" size="md" />
          <span className="a-sidebar__brand-text">VELORA</span>
        </Link>

        <ul className="a-sidebar__nav">
          {destinations.map((destination) => (
            <li key={destination.id}>
              <Link
                aria-current={
                  isCurrent(pathname, destination.path) ? 'page' : undefined
                }
                className="a-sidebar__item"
                data-testid={`nav-${destination.id}`}
                href={destination.path}
              >
                <Icon name={destination.icon} size="md" />
                <span className="a-sidebar__label">{destination.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="a-sidebar__foot">
          <Link
            aria-current={isCurrent(pathname, accessPath) ? 'page' : undefined}
            className="a-sidebar__session"
            data-testid="nav-access"
            href={accessPath}
          >
            <Icon name="shield" size="md" />
            <span className="a-sidebar__label">Access</span>
            {/*
              What this browser holds, in the server's own words. It is the one
              thing an operator most often needs to know on this surface, and
              printing the audience is not a claim about permission.
            */}
            <span className="a-sidebar__session-text a-caption a-quiet a-truncate">
              {session.audience ?? 'no session'}
            </span>
          </Link>
        </div>
      </nav>

      <div className="a-shell__main">
        <header
          className={`a-topbar${parent === undefined ? ' a-topbar--bare' : ''}`}
        >
          {parent === undefined ? (
            <Link className="a-topbar__brand" href="/queues">
              <Icon name="sparkle" size="md" />
              <span className="a-topbar__wordmark">VELORA</span>
            </Link>
          ) : (
            <Link
              aria-label="Back"
              className="a-icon-btn"
              data-testid="topbar-back"
              href={parent}
            >
              <Icon name="arrowLeft" size="md" />
            </Link>
          )}
          <p className="a-topbar__title a-subheading a-truncate">{title}</p>
          <Link
            aria-label="Access"
            className="a-icon-btn a-topbar__session"
            href={accessPath}
          >
            <Icon name="shield" size="md" />
          </Link>
        </header>

        <main className={`a-view${narrow ? ' a-view--narrow' : ''}`} id="main">
          <div className="a-view__inner">{children}</div>
        </main>
      </div>

      <nav aria-label="Console" className="a-tabbar">
        {destinations.map((destination) => (
          <Link
            aria-current={
              isCurrent(pathname, destination.path) ? 'page' : undefined
            }
            className="a-tabbar__item"
            data-testid={`tab-${destination.id}`}
            href={destination.path}
            key={destination.id}
          >
            <Icon name={destination.icon} size="md" />
            <span className="a-tabbar__label">{destination.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Confirmations and refusals, announced once.
 *
 * The region is polite rather than assertive: a toast reports something that has
 * already finished, and interrupting an operator mid-sentence to tell them a
 * read succeeded is the wrong trade. A refusal that needs to interrupt is an
 * `ErrorMessage` on the screen that caused it, not a toast.
 */
export function Toaster() {
  const { dismiss, toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="a-toaster" data-testid="toaster">
      {toasts.map((toast) => (
        <div className={`a-toast a-toast--${toast.tone}`} key={toast.id}>
          <span className="a-toast__icon">
            <Icon
              name={
                toast.tone === 'positive'
                  ? 'check'
                  : toast.tone === 'critical'
                    ? 'alert'
                    : 'info'
              }
              size="sm"
            />
          </span>
          <p className="a-toast__body">{toast.message}</p>
          <button
            aria-label="Dismiss"
            className="a-icon-btn a-icon-btn--sm"
            onClick={() => {
              dismiss(toast.id);
            }}
            type="button"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The access page's own layout.
 *
 * No navigation, because there is nowhere to navigate to until an authenticator
 * exists that this platform does not have.
 */
export function DoorLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="a-door">
      <main className="a-door__inner" id="main">
        <p className="a-door__brand">
          <Icon name="sparkle" size="md" />
          <span className="a-door__wordmark">VELORA</span>
        </p>
        {children}
      </main>
    </div>
  );
}
