'use client';

import { useState } from 'react';

import { failureMessage } from '@velora/consumer-client';

import { useApi, useToast } from '../app/providers';
import { ConfirmDialog, Dialog } from '../design/dialog';
import { Icon } from '../design/icons';
import {
  Button,
  Choice,
  ErrorMessage,
  Field,
  IconButton,
  Notice,
  TextArea,
} from '../design/primitives';
import { useSingleFlight } from './resource';

/**
 * Blocking and reporting, from wherever somebody is standing.
 *
 * `docs/design/01-design-principles.md` asks for safety to stay reachable
 * without the product feeling hostile, so these live behind one unobtrusive
 * control on every surface that shows a person rather than on a separate screen
 * somebody has to find and then paste an identifier into. The identifier is
 * already known here, which is the point: a safety flow that asks a frightened
 * person to copy a UUID is a safety flow that does not get used.
 *
 * Neither action tells the other person anything, and both say so. A block is
 * enforced by the server everywhere at once — discovery, introductions,
 * messages, calls, and queued notices — and this surface only asks for it.
 */

export interface Person {
  readonly displayName: string;
  readonly id: string;
}

const reportReasons = [
  { label: 'They may be under 18', value: 'underage_concern' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Sexual content violation', value: 'sexual_content_violation' },
  { label: 'Impersonation', value: 'impersonation' },
  { label: 'Spam or a scam', value: 'spam_or_scam' },
  { label: 'Something else', value: 'other' },
] as const;

type ReasonCode = (typeof reportReasons)[number]['value'];

/** The narrative bound the contract publishes for a report. */
const maximumReportDetail = 2000;

type Mode = 'menu' | 'block' | 'report';

export function PersonSafetyMenu({
  onBlocked,
  person,
  size = 'md',
}: {
  readonly onBlocked?: () => void;
  readonly person: Person;
  readonly size?: 'sm' | 'md';
}) {
  const [mode, setMode] = useState<Mode | undefined>(undefined);

  return (
    <>
      <IconButton
        data-testid={`safety-menu-${person.id}`}
        label={`Safety options for ${person.displayName}`}
        name="moreHorizontal"
        onClick={() => {
          setMode('menu');
        }}
        size={size}
      />

      {mode === 'menu' ? (
        <Dialog
          onClose={() => {
            setMode(undefined);
          }}
          testId="safety-menu"
          title={person.displayName}
        >
          <div className="v-stack v-stack--2">
            <Button
              block
              data-testid="safety-open-block"
              icon="ban"
              onClick={() => {
                setMode('block');
              }}
              tone="ghost"
            >
              Block this person
            </Button>
            <Button
              block
              data-testid="safety-open-report"
              icon="flag"
              onClick={() => {
                setMode('report');
              }}
              tone="ghost"
            >
              Report this person
            </Button>
          </div>
          <p className="v-caption v-quiet">
            Neither action tells them anything.
          </p>
        </Dialog>
      ) : null}

      {mode === 'block' ? (
        <BlockDialog
          onBlocked={onBlocked}
          onClose={() => {
            setMode(undefined);
          }}
          person={person}
        />
      ) : null}

      {mode === 'report' ? (
        <ReportDialog
          onClose={() => {
            setMode(undefined);
          }}
          person={person}
        />
      ) : null}
    </>
  );
}

export function BlockDialog({
  onBlocked,
  onClose,
  person,
}: {
  readonly onBlocked?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly person: Person;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <ConfirmDialog
      busy={busy}
      confirmLabel="Block"
      onCancel={onClose}
      onConfirm={() => {
        run(async () => {
          setError(undefined);
          const result = await api.block(person.id);
          const failure = failureMessage(result);
          if (failure !== undefined) {
            setError(failure);
            return;
          }
          toast.show(
            `${person.displayName} is blocked. They are not told.`,
            'positive',
          );
          onBlocked?.();
          onClose();
        });
      }}
      testId="block-person"
      title={`Block ${person.displayName}?`}
    >
      <p>
        You will not see each other in discovery, no introduction between you
        can continue, no message or call can reach either of you, and nothing
        tells them this happened.
      </p>
      <p>You can undo it later from your safety settings.</p>
      {error === undefined ? null : (
        <ErrorMessage testId="block-error">{error}</ErrorMessage>
      )}
    </ConfirmDialog>
  );
}

export function ReportDialog({
  onClose,
  onSubmitted,
  person,
}: {
  readonly onClose: () => void;
  readonly onSubmitted?: (() => void) | undefined;
  readonly person: Person;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [reasonCode, setReasonCode] = useState<ReasonCode>('harassment');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Dialog
      onClose={onClose}
      testId="report-person"
      title={`Report ${person.displayName}`}
    >
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            setError(undefined);
            const result = await api.report({
              // Makes submission retry-safe. The server scopes it to the
              // reporter, so it cannot collide with anybody else's.
              clientReportId: crypto.randomUUID(),
              ...(detail.trim().length === 0 ? {} : { detail: detail.trim() }),
              reasonCode,
              target: { accountId: person.id, type: 'consumer_account' },
            });
            const failure = failureMessage(result);
            if (failure !== undefined) {
              setError(failure);
              return;
            }
            toast.show(
              'Report received. They are not told who reported them.',
              'positive',
            );
            onSubmitted?.();
            onClose();
          });
        }}
      >
        <fieldset className="v-fieldset">
          <legend>What is wrong?</legend>
          {reportReasons.map((reason) => (
            <Choice
              checked={reasonCode === reason.value}
              key={reason.value}
              label={reason.label}
              name="reasonCode"
              onSelect={() => {
                setReasonCode(reason.value);
              }}
              value={reason.value}
            />
          ))}
        </fieldset>

        <Field
          count={{ length: detail.length, maximum: maximumReportDetail }}
          hint="Only read by VELORA. They are never shown it and never told who reported them."
          label="Anything you want to add"
          optional
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="report-detail"
              maxLength={maximumReportDetail}
              name="detail"
              onChange={(event) => {
                setDetail(event.target.value);
              }}
              rows={4}
              value={detail}
            />
          )}
        </Field>

        <Notice tone="quiet">
          You will not be told what happens next. That is deliberate: an outcome
          told to a reporter is an outcome the reported person can work out.
        </Notice>

        {error === undefined ? null : (
          <ErrorMessage testId="report-error">{error}</ErrorMessage>
        )}

        <div className="v-dialog__actions">
          <Button disabled={busy} onClick={onClose} tone="ghost">
            Cancel
          </Button>
          <Button
            busy={busy}
            data-testid="report-submit"
            tone="primary"
            type="submit"
          >
            Send report
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Shown where a safety action is the only thing left to offer. */
export function SafetyHint() {
  return (
    <p className="v-caption v-quiet v-inline v-inline--tight">
      <Icon name="shield" size="sm" />
      Blocking and reporting are on every profile and every conversation.
    </p>
  );
}
