'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { createConsumerApi } from '@velora/consumer-client';

import { Icon } from '../design/icons';
import { ButtonLink } from '../design/primitives';
import { captureAcquisition, invitationOpeningKey } from './acquisition';

/**
 * The page an invitation address lands on.
 *
 * Its first job is not to convert anybody. It is to be a page: somebody
 * followed a link a friend sent, and what they need is to find out what VELORA
 * is before deciding whether to sign up. So the explanation is the page, and
 * the invitation is the reason they are reading it.
 *
 * It does not name who invited them. An invitation address can be forwarded,
 * posted in a group, or scraped, so anything said here is said to everybody who
 * ever saw the link — and "X invited you" is a fact about X that X did not
 * agree to publish to strangers.
 *
 * **An invalid code is not an error page.** A link that was mistyped, truncated
 * by a chat client, or withdrawn by its owner still brought somebody here, and
 * turning them away at the door over a piece of bookkeeping is the most
 * expensive possible way to handle it. They get the same explanation and the
 * same way in; only the line about an invitation changes.
 */
export function Invitation({
  apiBaseUrl,
  code,
  fetchImplementation,
}: {
  readonly apiBaseUrl: string;
  readonly code: string;
  /** Injected by tests so the page renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
}) {
  const api = useMemo(
    () =>
      createConsumerApi({
        apiBaseUrl,
        ...(fetchImplementation === undefined
          ? {}
          : { fetch: fetchImplementation }),
        // No credential. An invitation is opened by somebody who has no
        // account, which is the entire point of one.
        transport: { headers: () => Promise.resolve({}) },
      }),
    [apiBaseUrl, fetchImplementation],
  );

  /*
   * Three states, and the page is readable in all of them.
   *
   * `unknown` is the moment before the server has answered, and it is a real
   * moment with a duration. Nothing on the page waits for it: the explanation
   * and the way in are rendered from the first paint, and only the sentence
   * about the invitation itself appears once there is something true to say.
   */
  const [usable, setUsable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    // Remembered before anything is asked, so a person who signs up after the
    // network call fails is still attributed. First touch: a code already held
    // from an earlier invitation is not replaced by this one.
    captureAcquisition({
      inviteCode: code,
      search: globalThis.location.search,
    });

    let abandoned = false;
    void api
      .openInvitation({ code, openingKey: invitationOpeningKey() })
      .then((result) => {
        if (abandoned) return;
        setUsable(result.kind === 'ok' ? result.value.usable : undefined);
      });
    return () => {
      abandoned = true;
    };
  }, [api, code]);

  return (
    <div className="v-landing">
      <div className="v-landing__glow" />
      <header className="v-landing__bar">
        <Link className="v-wordmark" href="/">
          <Icon name="sparkle" size="md" />
          VELORA
        </Link>
        <ButtonLink
          data-testid="invitation-sign-in"
          href="/sign-in"
          tone="secondary"
        >
          Sign in
        </ButtonLink>
      </header>

      <main className="v-public" id="main">
        <p className="v-label v-accent">You were invited</p>
        <h1 className="v-display v-public__title">
          Somebody wants you on VELORA.
        </h1>
        <p className="v-landing__lede">
          VELORA is an adults-only place to meet new people through live
          conversations — one person at a time, both of you looking at once.
        </p>

        {usable === false ? (
          <p className="v-small v-quiet" data-testid="invitation-unusable">
            This invitation link is no longer working — it may have been
            mistyped, cut short on the way to you, or withdrawn by the person
            who sent it. You can still join; nothing below depends on it.
          </p>
        ) : null}

        <section className="v-public__section">
          <h2 className="v-subheading">What happens when you join</h2>
          <ul>
            <li>
              You confirm you are an adult, choose a name, and you are in.
              Meeting people costs nothing.
            </li>
            <li>
              You are shown to other people only while you are looking, and you
              stop being visible when you stop.
            </li>
            <li>
              Your camera is optional, and can go off part way through a
              conversation while your voice keeps working.
            </li>
            <li>
              Nothing carries on unless both of you want it to, and nobody is
              ever told they were passed over.
            </li>
          </ul>
        </section>

        <p className="v-public__cta">
          <ButtonLink
            data-testid="invitation-start"
            href="/sign-in"
            size="lg"
            tone="primary"
          >
            Accept and get started
          </ButtonLink>
        </p>

        <p className="v-caption v-quiet">
          You must be an adult to use VELORA. You confirm that yourself when you
          join — it is a declaration you make, not an identity check we have
          run.
        </p>
      </main>

      <nav aria-label="More about VELORA" className="v-public__nav">
        <ul>
          <li>
            <Link href="/about">What VELORA is</Link>
          </li>
          <li>
            <Link href="/about/live">How live conversations work</Link>
          </li>
          <li>
            <Link href="/about/safety">Safety and control</Link>
          </li>
          <li>
            <Link href="/about/questions">Questions people ask</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
