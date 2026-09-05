'use client';

import { useCallback, useState } from 'react';

import { Button } from '../design/primitives';

/**
 * Sending a VELORA address to somebody, using whatever this device has.
 *
 * Three mechanisms in order of how good they are, and every one of them is the
 * browser's own. There is no sharing service here, no per-network button, and
 * no third-party script: a row of branded icons would mean asking a person's
 * browser to talk to five companies before they had decided to share anything,
 * and every one of those companies would learn which VELORA page they were
 * looking at.
 *
 * The system share sheet is offered where it exists, which on a phone is the
 * one somebody already knows how to use and reaches every app they have. The
 * clipboard is the fallback and is what most desktop browsers get. Where
 * neither is available the address is shown as text, selectable, which is worse
 * than both and still works.
 *
 * A share that the person cancels is not a failure and is not reported as one.
 * `AbortError` is the browser saying they changed their mind.
 */
export function ShareControl({
  label = 'Share',
  origin,
  path,
  testId,
  text,
  title,
}: {
  readonly label?: string;
  /**
   * The address this surface is reached at from outside, when one is declared.
   *
   * Empty on a machine with no public identity, and the browser's own origin
   * then fills in — resolved when the control is pressed rather than when the
   * page is built, so the server and the browser never disagree about what
   * they rendered.
   */
  readonly origin: string;
  /** The canonical path, without any query the reader happened to arrive with. */
  readonly path: string;
  readonly testId: string;
  /** The sentence that travels with the address, where a sheet shows one. */
  readonly text: string;
  readonly title: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [address, setAddress] = useState('');

  const share = useCallback(() => {
    const url = `${origin === '' ? globalThis.location.origin : origin}${path}`;
    setAddress(url);
    const navigate: Navigator = globalThis.navigator;
    if (typeof navigate.share === 'function') {
      void navigate
        .share({ text, title, url })
        .then(() => {
          setState('idle');
        })
        .catch(() => {
          // Cancelled, or refused by the platform. Either way the address is
          // still worth offering, so the fallback takes over rather than
          // reporting something that is not a problem.
          void copy(url).then((copied) => {
            setState(copied ? 'copied' : 'manual');
          });
        });
      return;
    }
    void copy(url).then((copied) => {
      setState(copied ? 'copied' : 'manual');
    });
  }, [origin, path, text, title]);

  return (
    <div className="v-share">
      <Button data-testid={testId} icon="link" onClick={share}>
        {label}
      </Button>
      {state === 'copied' ? (
        <p
          aria-live="polite"
          className="v-caption v-quiet"
          data-testid={`${testId}-copied`}
          role="status"
        >
          Link copied.
        </p>
      ) : null}
      {state === 'manual' ? (
        <p
          className="v-caption v-quiet v-share__address"
          data-testid={`${testId}-address`}
        >
          {address}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Whether the address made it to the clipboard.
 *
 * The API is unavailable outside a secure context and can be refused by a
 * permission policy, and neither is worth an error message — the caller shows
 * the address instead, which is what somebody would do with it anyway.
 */
async function copy(value: string): Promise<boolean> {
  try {
    // Reached through the navigator each time rather than captured, because
    // the property is absent outside a secure context and reading it there
    // throws rather than answering `undefined`.
    await globalThis.navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
