'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { LiveWindow } from '@velora/consumer-client';

import { Icon } from '../design/icons';

/**
 * The times VELORA is asking people to be looking at once.
 *
 * The problem it exists for is arithmetic rather than product: a live product
 * with few people is empty not because nobody came but because the people who
 * came were spread across a day. A window costs nothing, promises nothing, and
 * is the only lever a platform with no advertising budget has for that.
 *
 * Three things it deliberately does not say. It does not say how many people
 * are coming, because nothing knows. It does not say anybody will be here,
 * because nobody has promised to be. And it does not gate ordinary Live in any
 * way — before, during, and after a window, meeting somebody works exactly as
 * it always does, which is the difference between concentrating people and
 * manufacturing scarcity.
 */
export function LiveWindows({
  className = 'v-public__section',
  windows,
}: {
  /**
   * Where this is being drawn, because it appears in two different places.
   *
   * On a public page it is a band in a reading column; inside the product it is
   * a block in the shell's own stack, which has no rule above it. The words and
   * the list are identical either way — a person who read this before signing
   * up should not find a different promise afterwards.
   */
  readonly className?: string;
  readonly windows: readonly LiveWindow[];
}) {
  if (windows.length === 0) return null;
  return (
    <section
      aria-labelledby="live-windows-heading"
      className={className}
      data-testid="live-windows"
    >
      <h2 className="v-subheading" id="live-windows-heading">
        When people are here
      </h2>
      <p>
        VELORA asks everybody to come at the same times, so there are people to
        meet rather than an empty room. You can meet somebody at any hour — this
        is just when more people try.
      </p>
      <ul className="v-live-windows">
        {windows.map((window) => (
          <li className="v-live-windows__row" key={window.slug}>
            <span className="v-live-windows__mark">
              <Icon
                name={window.state === 'active' ? 'live' : 'clock'}
                size="md"
              />
            </span>
            <span className="v-live-windows__body">
              <Link
                className="v-live-windows__name"
                href={`/live-window/${window.slug}`}
              >
                {window.title}
              </Link>
              <span className="v-caption v-quiet">
                {window.state === 'active' ? 'Happening now · until ' : ''}
                <LocalMoment value={window.endsAt} />
                {window.state === 'active' ? null : (
                  <>
                    {' · from '}
                    <LocalMoment value={window.startsAt} />
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One instant, in the reader's own zone, without a hydration mismatch.
 *
 * The server has no idea what zone the reader is in, so it writes the instant
 * in UTC and the browser replaces it after mount. `suppressHydrationWarning` is
 * the honest way to say that: the two renders are *meant* to differ, because
 * one of them knows something the other cannot.
 *
 * The `datetime` attribute carries the exact instant either way, so anything
 * reading this document rather than looking at it — a crawler, a screen reader
 * announcing a time, a calendar extension — gets the unambiguous value rather
 * than one machine's idea of the afternoon.
 */
export function LocalMoment({ value }: { readonly value: string }) {
  const [local, setLocal] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLocal(
      new Date(value).toLocaleString(undefined, {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        timeZoneName: 'short',
      }),
    );
  }, [value]);
  return (
    <time dateTime={value} suppressHydrationWarning>
      {local ?? utcMoment(value)}
    </time>
  );
}

function utcMoment(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}
