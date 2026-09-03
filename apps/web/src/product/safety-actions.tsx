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
  { label: 'Harassment or bullying', value: 'harassment' },
  { label: 'Hate or abuse', value: 'hate_or_abuse' },
  { label: 'Threats or violence', value: 'threats_or_violence' },
  { label: 'Sexual content violation', value: 'sexual_content_violation' },
  { label: 'Impersonation or a fake profile', value: 'impersonation' },
  { label: 'Spam or a scam', value: 'spam_or_scam' },
  { label: 'Something else', value: 'other' },
] as const;

type ReasonCode = (typeof reportReasons)[number]['value'];

/** The narrative bound the contract publishes for a report. */
const maximumReportDetail = 2000;

type Mode = 'menu' | 'block' | 'report' | 'report-and-block';

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
            {/*
              The two together, because that is usually what somebody actually
              wants and doing it as two taps means two chances to stop halfway.
              The server applies the block first, so this cannot leave somebody
              believing they are separated when they are not.
            */}
            <Button
              block
              data-testid="safety-open-report-and-block"
              icon="shield"
              onClick={() => {
                setMode('report-and-block');
              }}
              tone="ghost"
            >
              Report and block
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

      {mode === 'report' || mode === 'report-and-block' ? (
        <ReportDialog
          alsoBlock={mode === 'report-and-block'}
          onClose={() => {
            setMode(undefined);
          }}
          {...(onBlocked === undefined ? {} : { onBlocked })}
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

/**
 * Reporting, optionally with the block that usually belongs with it.
 *
 * `alsoBlock` picks the endpoint rather than adding a second request. The
 * server applies the block first and answers with it, so what this renders
 * afterwards is what actually happened: separated, and reported when a report
 * was taken. That distinction matters — the reporting bound exists, and telling
 * somebody their report was filed when it was not would be worse than telling
 * them it was not.
 */
export function ReportDialog({
  alsoBlock = false,
  onBlocked,
  onClose,
  onSubmitted,
  person,
}: {
  readonly alsoBlock?: boolean;
  readonly onBlocked?: (() => void) | undefined;
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
      title={
        alsoBlock
          ? `Report and block ${person.displayName}`
          : `Report ${person.displayName}`
      }
    >
      <form
        className="v-stack v-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            setError(undefined);
            // Generated once per submission and reused by nothing else. The
            // server scopes it to the reporter, so it cannot collide with
            // anybody else's, and a retry of the same submission is one report.
            const clientReportId = crypto.randomUUID();
            const detailFields =
              detail.trim().length === 0 ? {} : { detail: detail.trim() };
            if (alsoBlock) {
              const result = await api.reportWithBlock({
                clientReportId,
                ...detailFields,
                reasonCode,
                targetAccountId: person.id,
              });
              const failure = failureMessage(result);
              if (failure !== undefined) {
                setError(failure);
                return;
              }
              const reported =
                'value' in result && result.value.report !== undefined;
              toast.show(
                reported
                  ? `${person.displayName} is blocked and your report was received. They are not told either happened.`
                  : `${person.displayName} is blocked. We could not take another report from you right now, and the block still stands.`,
                reported ? 'positive' : 'neutral',
              );
              onBlocked?.();
              onSubmitted?.();
              onClose();
              return;
            }
            const result = await api.report({
              clientReportId,
              ...detailFields,
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

        {alsoBlock ? (
          <Notice icon="ban" testId="report-and-block-effect" tone="quiet">
            <p>
              Sending this blocks {person.displayName} straight away: you will
              not see each other in discovery, no message or call can reach
              either of you, and the matcher will not put you together again.
              Nothing tells them any of it happened.
            </p>
          </Notice>
        ) : null}

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
            {alsoBlock ? 'Report and block' : 'Send report'}
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
