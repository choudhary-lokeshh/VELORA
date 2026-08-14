'use client';

import { useCallback, useRef, useState } from 'react';

import type { ApiResult, ConsumerApi } from '@velora/consumer-client';
import { failureMessage } from '@velora/consumer-client';
import { useResource, useSingleFlight } from './resource';
import { EmptyState, ResourceState, Section, StatusMessage } from './ui';

/**
 * Blocks and reports.
 *
 * A block is a safety action, not a display filter. The server stops the pair
 * from reaching each other everywhere — discovery, introductions, messages, and
 * queued notifications — and this screen only asks for it. It never claims the
 * other person was told, because they are not, and it never shows who has
 * blocked the person using it, because that is somebody else's decision.
 *
 * A report is evidence. The reporter learns that their report exists and what
 * state it is in, and nothing more: there is no moderator, no rationale, no
 * enforcement outcome, and no copy of the narrative they wrote. The narrative
 * is sent once and never echoed back, so it cannot be read out of this surface
 * or logged from it.
 */

const reportReasons = [
  { label: 'They may be under 18', value: 'underage_concern' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Sexual content violation', value: 'sexual_content_violation' },
  { label: 'Impersonation', value: 'impersonation' },
  { label: 'Spam or a scam', value: 'spam_or_scam' },
  { label: 'Something else', value: 'other' },
] as const;

const maximumReportDetail = 2000;

export function SafetyPanel({ api }: { readonly api: ConsumerApi }) {
  const loadBlocks = useCallback(
    async (signal: AbortSignal) => api.blocks({}, signal),
    [api],
  );
  const loadReports = useCallback(
    async (signal: AbortSignal) => api.reports({}, signal),
    [api],
  );
  const blocks = useResource(loadBlocks);
  const reports = useResource(loadReports);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [targetId, setTargetId] = useState('');
  const { busy, run } = useSingleFlight();

  const act = (work: () => Promise<ApiResult<unknown>>, success: string) => {
    run(async () => {
      setNotice(undefined);
      const result = await work();
      setNotice(result.kind === 'ok' ? success : failureMessage(result));
      blocks.reload();
    });
  };

  const blocked = blocks.value?.blocks ?? [];

  return (
    <>
      <Section headingId="blocks-heading" title="Blocked people">
        <ResourceState resource={blocks} testId="blocks" />
        {notice === undefined ? null : (
          <StatusMessage testId="safety-notice">{notice}</StatusMessage>
        )}
        {!blocks.loading &&
        blocks.error === undefined &&
        blocked.length === 0 ? (
          <EmptyState testId="blocks-empty">
            You have not blocked anybody.
          </EmptyState>
        ) : null}

        <ul data-testid="block-list">
          {blocked.map((block) => (
            <li key={block.blockedId}>
              <p>{block.blockedId}</p>
              <button
                data-testid={`unblock-${block.blockedId}`}
                disabled={busy}
                onClick={() => {
                  act(
                    async () => api.unblock(block.blockedId),
                    'Block removed. They are not told either way.',
                  );
                }}
                type="button"
              >
                Remove block
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            act(
              async () => api.block(targetId),
              'Blocked. They are not told, and they cannot reach you.',
            );
          }}
        >
          <label htmlFor="block-target">
            Block someone by their identifier
          </label>
          <input
            id="block-target"
            name="targetId"
            onChange={(event) => {
              setTargetId(event.target.value);
            }}
            required
            value={targetId}
          />
          <button data-testid="block-submit" disabled={busy} type="submit">
            Block
          </button>
        </form>
      </Section>

      <ReportForm
        api={api}
        onSubmitted={() => {
          reports.reload();
        }}
      />

      <Section headingId="reports-heading" title="Your reports">
        <ResourceState resource={reports} testId="reports" />
        {!reports.loading &&
        reports.error === undefined &&
        (reports.value?.reports.length ?? 0) === 0 ? (
          <EmptyState testId="reports-empty">
            You have not reported anybody.
          </EmptyState>
        ) : null}
        <ul data-testid="report-list">
          {(reports.value?.reports ?? []).map((report) => (
            <li key={report.id}>
              <p>{report.reasonCode.replaceAll('_', ' ')}</p>
              {/* The lifecycle position, and nothing about the decision. */}
              <p className="hint">{report.state.replaceAll('_', ' ')}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/**
 * The minimum safe report flow.
 *
 * The form opens in place rather than in a modal dialog. There is no focus
 * trap to get wrong, Escape needs no special handling, and the fields are in
 * the document's own reading order — which is a better outcome than a dialog
 * implemented carefully. Focus moves into the form when it opens and back to
 * the control that opened it when it closes.
 */
function ReportForm({
  api,
  onSubmitted,
}: {
  readonly api: ConsumerApi;
  readonly onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [reasonCode, setReasonCode] =
    useState<(typeof reportReasons)[number]['value']>('harassment');
  const [detail, setDetail] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();
  const trigger = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setDetail('');
    trigger.current?.focus();
  };

  return (
    <Section headingId="report-heading" title="Report someone">
      {/*
        The trigger stays in the document while the form is open. Unmounting it
        would drop the reference focus has to return to, and the person closing
        the form would land back at the top of the page.
      */}
      <button
        aria-expanded={open}
        data-testid="report-open"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          // Focus follows the disclosure, so a keyboard user lands in the form
          // rather than where they already were.
          queueMicrotask(() => firstField.current?.focus());
        }}
        ref={trigger}
        type="button"
      >
        {open ? 'Cancel report' : 'Report someone'}
      </button>
      {message === undefined ? null : (
        <StatusMessage testId="report-message">{message}</StatusMessage>
      )}

      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              setMessage(undefined);
              const result = await api.report({
                // Makes submission retry-safe. The server scopes it to the
                // reporter, so it cannot collide with anybody else's.
                clientReportId: crypto.randomUUID(),
                ...(detail.trim().length === 0 ? {} : { detail }),
                reasonCode,
                subjectId,
              });
              if (result.kind === 'ok') {
                setMessage(
                  'Report received. You will not be told what happens next, and the other person is not told you reported them.',
                );
                onSubmitted();
                close();
                return;
              }
              setMessage(failureMessage(result));
            });
          }}
        >
          <label htmlFor="report-subject">Who are you reporting?</label>
          <input
            id="report-subject"
            name="subjectId"
            onChange={(event) => {
              setSubjectId(event.target.value);
            }}
            ref={firstField}
            required
            value={subjectId}
          />

          <fieldset>
            <legend>What is wrong?</legend>
            {reportReasons.map((reason) => (
              <div className="row" key={reason.value}>
                <input
                  checked={reasonCode === reason.value}
                  id={`report-reason-${reason.value}`}
                  name="reasonCode"
                  onChange={() => {
                    setReasonCode(reason.value);
                  }}
                  type="radio"
                  value={reason.value}
                />
                <label htmlFor={`report-reason-${reason.value}`}>
                  {reason.label}
                </label>
              </div>
            ))}
          </fieldset>

          <label htmlFor="report-detail">Anything you want to add</label>
          <textarea
            aria-describedby="report-detail-help"
            id="report-detail"
            maxLength={maximumReportDetail}
            name="detail"
            onChange={(event) => {
              setDetail(event.target.value);
            }}
            rows={4}
            value={detail}
          />
          <p className="hint" id="report-detail-help">
            Optional, and only read by VELORA. The person you are reporting is
            never shown it or told who reported them.
          </p>

          <button data-testid="report-submit" disabled={busy} type="submit">
            Send report
          </button>
        </form>
      ) : null}
    </Section>
  );
}
