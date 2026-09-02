'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

import { Icon } from './icons';
import { Button, type ButtonTone } from './primitives';

/**
 * A modal, with the three things a modal has to get right.
 *
 * Focus enters it when it opens, cannot leave it while it is open, and returns
 * to the control that opened it when it closes. `docs/design/05-accessibility-motion.md`
 * requires all three, and a dialog that gets any one of them wrong strands a
 * keyboard user behind a scrim they cannot reach the close button of.
 *
 * The implementation is explicit rather than delegated to `<dialog>.showModal()`
 * on purpose: the browser primitive is not implemented in the DOM the unit tests
 * run in, and an accessibility guarantee that is only exercised in a real browser
 * is one that regresses between browser runs.
 *
 * Below the tablet breakpoint the same component presents as a bottom sheet.
 * That is a stylesheet decision, not a second component: the semantics of "this
 * is the only thing you can interact with right now" do not change with width.
 */

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  children,
  labelledBy,
  onClose,
  testId,
  title,
}: {
  readonly children: ReactNode;
  /** Supplied when the caller renders its own heading inside the dialog. */
  readonly labelledBy?: string;
  readonly onClose: () => void;
  readonly testId?: string | undefined;
  readonly title?: string | undefined;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);
  const generatedId = useId();
  const headingId = labelledBy ?? `${generatedId}-title`;

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  /**
   * The system Back button, honoured while this is open.
   *
   * On a phone the hardware Back is how overlays are dismissed, and a dialog
   * that ignored it let Back navigate the page out from underneath an open
   * sheet. Opening pushes one history entry whose only meaning is "an overlay
   * is open"; popping it — hardware Back, browser Back — closes the dialog and
   * goes nowhere. Closing any other way consumes the entry, so Back afterwards
   * does not need pressing twice.
   *
   * The consume is guarded on the entry still being the current one: a dialog
   * whose action navigated somewhere has already replaced it, and popping then
   * would undo the navigation somebody just asked for.
   */
  const latestClose = useRef(close);
  latestClose.current = close;
  useEffect(() => {
    window.history.pushState({ veloraOverlay: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      latestClose.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const state: unknown = window.history.state;
      const marked =
        typeof state === 'object' &&
        state !== null &&
        (state as { veloraOverlay?: unknown }).veloraOverlay === true;
      if (!popped && marked) window.history.back();
    };
  }, []);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    const node = panel.current;
    // Focus the first thing somebody came here to do, rather than the control
    // that leaves. The close control is still reachable — it is the next thing
    // Tab reaches backwards — but landing on it would put "cancel" under the
    // first key somebody presses.
    const focusable = [
      ...(node?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
    ];
    const first =
      focusable.find((element) => element.dataset.dialogClose === undefined) ??
      focusable[0];
    (first ?? node)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      const target = restoreTo.current;
      if (target instanceof HTMLElement) target.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = panel.current;
      if (node === null) return;
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [close]);

  return (
    <>
      {/*
        The scrim closes on a press because that is what a press outside a modal
        means everywhere else. It is not the only way out: Escape and the close
        control both work, so nothing depends on hitting a target.
      */}
      <div className="v-scrim" onClick={close} />
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        className="v-dialog"
        data-testid={testId}
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <span className="v-sheet-grip" />
        {title === undefined ? null : (
          <div className="v-dialog__head">
            <h2 className="v-heading v-wrap" id={headingId}>
              {title}
            </h2>
            <button
              aria-label="Close"
              className="v-dialog__close v-icon-btn v-icon-btn--sm"
              data-dialog-close="true"
              data-testid="dialog-close"
              onClick={close}
              type="button"
            >
              <Icon name="x" size="sm" />
            </button>
          </div>
        )}
        {children}
      </div>
    </>
  );
}

/**
 * A destructive or high-impact confirmation.
 *
 * `docs/design/06-screen-state-requirements.md` requires the exact target and
 * effect to be visible at the moment of confirming, so both are parameters
 * rather than something the caller may leave to a colour.
 */
export function ConfirmDialog({
  busy = false,
  cancelLabel = 'Cancel',
  children,
  confirmLabel,
  confirmTone = 'danger',
  onCancel,
  onConfirm,
  testId,
  title,
}: {
  readonly busy?: boolean;
  readonly cancelLabel?: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly confirmTone?: ButtonTone;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly testId?: string;
  readonly title: string;
}) {
  return (
    <Dialog onClose={onCancel} testId={testId} title={title}>
      <div className="v-small v-muted v-stack v-stack--3">{children}</div>
      <div className="v-dialog__actions">
        <Button
          data-testid={`${testId ?? 'confirm'}-cancel`}
          disabled={busy}
          onClick={onCancel}
          tone="ghost"
        >
          {cancelLabel}
        </Button>
        <Button
          busy={busy}
          data-testid={`${testId ?? 'confirm'}-accept`}
          onClick={onConfirm}
          tone={confirmTone}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
