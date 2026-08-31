'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';

import { Icon } from '../design/icons';
import { Avatar } from '../design/primitives';
import { PageHeadingWatcher } from './page-heading';
import {
  backTarget,
  destinationName,
  destinations,
  isCurrent,
} from './navigation';
import { useAccount, useFeeds, useToast } from './providers';

/**
 * The application shell.
 *
 * One navigation model, three arrangements. Which one a person gets is decided
 * by the width the content needs rather than by a device name, and each is
 * built for its own input: a bottom bar within thumb reach on a phone, a
 * labelled rail on a tablet, a persistent sidebar on a desktop.
 *
 * Both navigations are rendered, and the stylesheet shows one. That is
 * deliberate: choosing in JavaScript would mean the first paint after hydration
 * has the wrong one, and a navigation that flickers between two shapes on every
 * load is worse than one extra list in the document.
 */
/**
 * What a badge is counting, said in full for a screen reader.
 *
 * The number on Messages is conversations with something new in them, not
 * messages: the contract publishes no message count, and a badge that read
 * "unread" would be inviting somebody to conclude one.
 */
const signalLabels: Readonly<
  Record<'conversations' | 'notifications', string>
> = {
  conversations: 'conversations with new messages',
  notifications: 'unread notices',
};

export function AppShell({
  children,
  immersive = false,
  narrow = false,
  title,
}: {
  readonly children: ReactNode;
  /**
   * Whether the page owns the whole area rather than sitting in the measure.
   *
   * One surface uses it: Live, whose subject is a camera. The reading column
   * that makes every other screen legible is the wrong container for a picture
   * of a person, and letting the page opt out here is smaller and more honest
   * than a page fighting its own shell with negative margins.
   */
  readonly immersive?: boolean;
  /** Settings-shaped pages read better at a bounded measure than at full width. */
  readonly narrow?: boolean;
  /** Shown in the phone header, where there is no room for a sidebar. */
  readonly title: string;
}) {
  const pathname = usePathname();
  const parameters = useSearchParams();
  const account = useAccount();
  const feeds = useFeeds();
  const displayName = account.profile.value?.displayName ?? 'Your account';
  const back = backTarget(pathname, parameters.get('from'));
  const backName = back === undefined ? undefined : destinationName(back);
  /*
   * Whether the page's own heading is on screen. Undefined means the page did
   * not offer one, and the bar then names the page for the whole of it, which
   * is what every screen used to get.
   */
  const [headingVisible, setHeadingVisible] = useState<boolean | undefined>(
    undefined,
  );
  const watchHeading = useCallback((visible: boolean | undefined) => {
    setHeadingVisible(visible);
  }, []);

  const signalCount = (
    signal: 'conversations' | 'notifications' | undefined,
  ) =>
    signal === undefined
      ? 0
      : signal === 'conversations'
        ? feeds.unreadConversations
        : feeds.unreadNotifications;

  return (
    <div className="v-shell">
      <a className="v-skip-link" href="#main">
        Skip to content
      </a>

      <nav aria-label="Primary" className="v-sidebar">
        <Link className="v-sidebar__brand" href="/live">
          <Icon name="sparkle" size="md" />
          <span className="v-sidebar__brand-text">VELORA</span>
        </Link>

        <ul className="v-sidebar__nav">
          {destinations.map((destination) => {
            const current = isCurrent(pathname, destination.path);
            const count = signalCount(destination.signal);
            return (
              <li key={destination.id}>
                <Link
                  aria-current={current ? 'page' : undefined}
                  className="v-sidebar__item"
                  data-testid={`nav-${destination.id}`}
                  href={destination.path}
                >
                  <Icon name={destination.icon} size="md" />
                  <span className="v-sidebar__label">{destination.label}</span>
                  {count > 0 ? (
                    <span
                      className="v-count"
                      data-testid={`nav-count-${destination.id}`}
                    >
                      {count > 99 ? '99+' : count}
                      <span className="v-visually-hidden">
                        {' '}
                        {signalLabels[destination.signal ?? 'notifications']}
                      </span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="v-sidebar__foot">
          <Link className="v-sidebar__account" href="/you">
            <Avatar displayName={displayName} size="xs" />
            <span className="v-sidebar__account-name v-small v-truncate">
              {displayName}
            </span>
          </Link>
        </div>
      </nav>

      <div className="v-shell__main">
        {/*
          The bar carries the way back, so it is only bare on a page there is
          no way back from. A wide window hides the bare one — the sidebar
          already names the destination and a bar repeating it would be a second
          title above the first — and keeps the one holding the Back, because a
          page opened from somewhere has to be leavable at every width rather
          than only on a phone.
        */}
        <header
          className={`v-topbar${back === undefined ? ' v-topbar--bare' : ''}`}
        >
          {/*
            The browser's own Back still works; this is for the hand holding the
            phone, which is nowhere near it, and for the window where nothing
            else on screen leads out of this page.
          */}
          {back === undefined ? null : (
            /*
              Named where the destination it returns to has a name. A bare arrow
              is unambiguous on a phone, where the page it leaves is the whole
              screen; on a wide window it is the only thing in an otherwise
              empty bar, and an arrow alone above Sent gifts does not say that
              Sent gifts is part of You.
            */
            <Link
              aria-label={
                backName === undefined ? 'Back' : `Back to ${backName}`
              }
              className={
                backName === undefined ? 'v-icon-btn' : 'v-topbar__back'
              }
              data-testid="topbar-back"
              href={back}
            >
              <Icon name="arrowLeft" size="md" />
              {backName === undefined ? null : (
                <span className="v-topbar__back-label v-small">{backName}</span>
              )}
            </Link>
          )}
          <p
            className="v-topbar__title v-subheading v-truncate"
            data-shown={headingVisible === true ? 'false' : 'true'}
          >
            {title}
          </p>
          <Link aria-label="Your account" className="v-icon-btn" href="/you">
            <Avatar displayName={displayName} size="xs" />
          </Link>
        </header>

        <main
          className={`v-view${narrow ? ' v-view--narrow' : ''}${
            immersive ? ' v-view--immersive' : ''
          }`}
          id="main"
        >
          <div className="v-view__inner">
            <PageHeadingWatcher onChange={watchHeading}>
              {children}
            </PageHeadingWatcher>
          </div>
        </main>
      </div>

      <nav aria-label="Primary" className="v-tabbar">
        {destinations.map((destination) => {
          const current = isCurrent(pathname, destination.path);
          const count = signalCount(destination.signal);
          return (
            <Link
              aria-current={current ? 'page' : undefined}
              className="v-tabbar__item"
              data-testid={`tab-${destination.id}`}
              href={destination.path}
              key={destination.id}
            >
              <span className="v-tabbar__mark">
                <Icon name={destination.icon} size="md" />
                {count > 0 ? (
                  <>
                    <span className="v-tabbar__badge" />
                    <span className="v-visually-hidden">
                      {String(count)}{' '}
                      {signalLabels[destination.signal ?? 'notifications']}
                    </span>
                  </>
                ) : null}
              </span>
              <span className="v-tabbar__label">{destination.label}</span>
            </Link>
          );
        })}
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
    <div aria-live="polite" className="v-toaster" data-testid="toaster">
      {toasts.map((toast) => (
        <div className={`v-toast v-toast--${toast.tone}`} key={toast.id}>
          <span className="v-toast__icon">
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
          <p className="v-toast__body">{toast.message}</p>
          <button
            aria-label="Dismiss"
            className="v-icon-btn v-icon-btn--sm"
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
