'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon } from '../design/icons';
import { CreatorAvatar } from '../design/primitives';
import { accountPath, destinations, isCurrent, parentOf } from './navigation';
import { useCreator, useToast } from './providers';

/**
 * The workspace shell.
 *
 * One navigation model, three arrangements. Which one a creator gets is decided
 * by the width the work needs rather than by a device name, and each is built
 * for its own input: a bottom bar within thumb reach on a phone, a labelled rail
 * on a tablet, a persistent sidebar on a desktop.
 *
 * Both navigations are rendered and the stylesheet shows one. That is
 * deliberate: choosing in JavaScript would mean the first paint after hydration
 * has the wrong one, and a navigation that flickers between two shapes on every
 * load is worse than one extra list in the document.
 *
 * There is no notification control anywhere in this shell. The notification
 * contract is a consumer-audience one — a Creator Studio credential is refused
 * by it — so there is no creator notification to count, and a bell with a
 * number beside it would be the first fabricated figure on the surface.
 */
export function StudioShell({
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
  const creator = useCreator();
  const displayName = creator.profile.value?.displayName ?? 'Your account';
  const handle = creator.profile.value?.handle;
  const parent = parentOf(pathname);

  return (
    <div className="s-shell">
      <a className="s-skip-link" href="#main">
        Skip to content
      </a>

      <nav aria-label="Studio" className="s-sidebar">
        <Link className="s-sidebar__brand" href="/home">
          <Icon name="sparkle" size="md" />
          <span className="s-sidebar__brand-text">VELORA</span>
        </Link>

        <ul className="s-sidebar__nav">
          {destinations.map((destination) => (
            <li key={destination.id}>
              <Link
                aria-current={
                  isCurrent(pathname, destination.path) ? 'page' : undefined
                }
                className="s-sidebar__item"
                data-testid={`nav-${destination.id}`}
                href={destination.path}
              >
                <Icon name={destination.icon} size="md" />
                <span className="s-sidebar__label">{destination.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="s-sidebar__foot">
          <Link
            aria-current={isCurrent(pathname, accountPath) ? 'page' : undefined}
            className="s-sidebar__account"
            data-testid="nav-account"
            href={accountPath}
          >
            <CreatorAvatar
              displayName={displayName}
              seed={handle ?? displayName}
              size="xs"
            />
            <span className="s-sidebar__account-name s-small s-truncate">
              {displayName}
            </span>
          </Link>
        </div>
      </nav>

      <div className="s-shell__main">
        {/*
          On a phone this bar carries the wordmark, the page's name, and the way
          back. From the tablet up the sidebar already says where somebody is,
          so a bar repeating it would be a second title above the first — it
          stays only where there is somewhere to go back to.
        */}
        <header
          className={`s-topbar${parent === undefined ? ' s-topbar--bare' : ''}`}
        >
          {/*
            A phone shows one destination at a time, so a page underneath one
            needs a way back that is visible. The browser's own Back still
            works; this is for the hand holding the phone, which is nowhere near
            it.
          */}
          {parent === undefined ? (
            <Link className="s-topbar__brand" href="/home">
              <Icon name="sparkle" size="md" />
              <span className="s-topbar__wordmark">VELORA</span>
            </Link>
          ) : (
            <Link
              aria-label="Back"
              className="s-icon-btn"
              data-testid="topbar-back"
              href={parent}
            >
              <Icon name="arrowLeft" size="md" />
            </Link>
          )}
          <p className="s-topbar__title s-subheading s-truncate">{title}</p>
          <Link
            aria-label="Your account"
            className="s-icon-btn s-topbar__account"
            href={accountPath}
          >
            <CreatorAvatar
              displayName={displayName}
              seed={handle ?? displayName}
              size="xs"
            />
          </Link>
        </header>

        <main className={`s-view${narrow ? ' s-view--narrow' : ''}`} id="main">
          <div className="s-view__inner">{children}</div>
        </main>
      </div>

      <nav aria-label="Studio" className="s-tabbar">
        {destinations.map((destination) => (
          <Link
            aria-current={
              isCurrent(pathname, destination.path) ? 'page' : undefined
            }
            className="s-tabbar__item"
            data-testid={`tab-${destination.id}`}
            href={destination.path}
            key={destination.id}
          >
            <Icon name={destination.icon} size="md" />
            <span className="s-tabbar__label">{destination.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Confirmations and failures, announced once.
 *
 * The region is polite rather than assertive: a toast reports something that has
 * already finished, and interrupting somebody mid-sentence to tell them a save
 * succeeded is the wrong trade.
 */
export function Toaster() {
  const { dismiss, toasts } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="s-toaster" data-testid="toaster">
      {toasts.map((toast) => (
        <div className={`s-toast s-toast--${toast.tone}`} key={toast.id}>
          <span className="s-toast__icon">
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
          <p className="s-toast__body">{toast.message}</p>
          <button
            aria-label="Dismiss"
            className="s-icon-btn s-icon-btn--sm"
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
 * The entry surface: sign-in and activation.
 *
 * No navigation, because there is nowhere else to go until the server has
 * answered. One column, centred, with the wordmark above it, so the page says
 * what it is before it asks for anything.
 */
export function EntryLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="s-entry">
      <div className="s-entry__inner">
        <p className="s-entry__brand">
          <Icon name="sparkle" size="md" />
          <span className="s-entry__wordmark">VELORA</span>
        </p>
        {children}
      </div>
    </div>
  );
}
