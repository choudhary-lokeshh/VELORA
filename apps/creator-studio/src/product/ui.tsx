'use client';

import type { ReactNode } from 'react';

import type { Resource } from './resource';

/**
 * The small set of presentational pieces every product surface shares.
 *
 * They exist for one reason: every screen has to say the same true things in
 * the same way. A screen that is loading says so out loud, a screen that failed
 * says what failed and whether trying again could help, and a screen with
 * nothing to show says that rather than showing an empty box. None of that is
 * decoration, and none of it is safe to leave to each surface's discretion.
 *
 * There is no invented visual language here. `packages/design-tokens` publishes
 * the approved foundation — the signal colour, the focus width, the rhythm, the
 * typefaces — and marks exact theme values `DESIGN REQUIRED`. Everything below
 * uses semantic HTML and the browser's own system colours, so the surface is
 * legible and contrast-correct in both schemes without anybody guessing at a
 * palette that has not been approved.
 */

export function Section({
  children,
  headingId,
  title,
}: {
  readonly children: ReactNode;
  readonly headingId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * A polite announcement of what the surface is doing.
 *
 * `role="status"` rather than `role="alert"`: progress and confirmations should
 * reach a screen reader without interrupting what somebody is typing.
 */
export function StatusMessage({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p aria-live="polite" className="status" data-testid={testId} role="status">
      {children}
    </p>
  );
}

/**
 * Something went wrong, said once and assertively.
 *
 * `role="alert"` because a failed action has to interrupt: somebody who has
 * just pressed a button and heard nothing will press it again.
 */
export function ErrorMessage({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p className="error" data-testid={testId} role="alert">
      {children}
    </p>
  );
}

/**
 * A resource's own state, rendered honestly.
 *
 * Every branch terminates. There is no arrangement of inputs that produces a
 * spinner with no end, and none that produces silence after a failure — which
 * is the whole reason this component exists rather than each surface writing
 * its own conditional.
 */
export function ResourceState<T>({
  emptyMessage,
  resource,
  testId,
}: {
  readonly emptyMessage?: string;
  readonly resource: Resource<T>;
  readonly testId: string;
}) {
  if (resource.error !== undefined) {
    return (
      <div data-testid={`${testId}-failed`}>
        <ErrorMessage>{resource.error}</ErrorMessage>
        {resource.retryable ? (
          <button onClick={resource.reload} type="button">
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  if (resource.loading && resource.value === undefined) {
    return <StatusMessage testId={`${testId}-loading`}>Loading…</StatusMessage>;
  }
  if (resource.value === undefined && emptyMessage !== undefined) {
    return (
      <StatusMessage testId={`${testId}-empty`}>{emptyMessage}</StatusMessage>
    );
  }
  return null;
}

/**
 * "There is nothing here", said plainly.
 *
 * An empty discovery feed is a real and expected product state, not a failure
 * and not a loading screen that never resolves.
 */
export function EmptyState({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) {
  return (
    <p className="empty" data-testid={testId}>
      {children}
    </p>
  );
}

/**
 * A continuation control.
 *
 * Rendered only when the server offered a cursor. A short page with a cursor is
 * not "no more results", so the button says what it does rather than promising
 * how much is left — the server never told the client that.
 */
export function MoreButton({
  busy,
  label,
  onClick,
  testId,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
}) {
  return (
    <button
      data-testid={testId}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy ? 'Loading…' : label}
    </button>
  );
}
