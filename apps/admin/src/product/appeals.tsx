'use client';

import { useCallback, useState } from 'react';

import type { ApiResult } from '@velora/api-client';

import type { Appeal, AppealList } from '../api/contract';
import { failureMessage } from '../api/messages';
import { ConfirmDialog } from '../design/dialog';
import {
  Acknowledgement,
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  ErrorState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  RowSkeleton,
  Scroller,
  Table,
} from '../design/primitives';
import { useApi, useToast } from '../app/providers';
import {
  appealStateLook,
  formatDateTime,
  formatRemaining,
  shortId,
} from './format';
import { useResource, useSingleFlight } from './resource';

/**
 * Appeals against decisions already made.
 *
 * The one queue on this surface where the operator is reviewing the platform
 * rather than a person, so it says so: an appeal names the decision it contests
 * and nothing about the appellant beyond whether they were the subject of the
 * decision or the person who reported it. TRUST & SAFETY publishes no identity
 * here and this console asks for none.
 *
 * Resolving one carries the version the operator was looking at, so two
 * reviewers reaching the same appeal produce one outcome and one refusal.
 *
 * `outcomeDecisionId` is deliberately not a field on this screen. Upholding an
 * appeal by pointing at a replacement decision is a two-step operation — record
 * the new decision on the case, then name it here — and a free-text identifier
 * box would invite an operator to guess at one. The screen resolves the appeal;
 * the decision that supersedes belongs on the case.
 */

const appealPageSize = 50;

export function Appeals() {
  const api = useApi();
  const load = useCallback(
    async () => api.appeals({ pageSize: appealPageSize }),
    [api],
  );
  const appeals = useResource<AppealList>(load);
  const rows = appeals.value?.appeals ?? [];
  const open = rows.filter(
    (appeal) => appeal.state === 'received' || appeal.state === 'under_review',
  );

  return (
    <>
      <PageHeader
        eyebrow="Queues"
        lede="Every appeal the platform is holding. An appeal contests one decision and is decided on its own record."
        title="Appeals"
      />

      <Panel testId="appeal-list">
        <PanelHead
          actions={
            rows.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {open.length} awaiting an outcome
              </span>
            )
          }
          title="Appeals"
        />

        {appeals.error !== undefined && appeals.value === undefined ? (
          <PanelBody>
            <ErrorState
              body={appeals.error}
              onRetry={appeals.retryable ? appeals.reload : undefined}
              testId="appeal-list-failed"
            />
          </PanelBody>
        ) : appeals.loading && appeals.value === undefined ? (
          <PanelBody>
            <RowSkeleton rows={4} />
          </PanelBody>
        ) : rows.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="Nobody has appealed a decision the platform has made."
              icon="scale"
              testId="appeal-list-empty"
              title="No appeals"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Appeals">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Appeal</th>
                    <th scope="col">Against</th>
                    <th scope="col">From</th>
                    <th scope="col">State</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Window</th>
                    <th scope="col">
                      <span className="a-visually-hidden">Outcome</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((appeal) => (
                    <AppealRow
                      appeal={appeal}
                      key={appeal.id}
                      onChanged={appeals.reload}
                    />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>
    </>
  );
}

function AppealRow({
  appeal,
  onChanged,
}: {
  readonly appeal: Appeal;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [resolving, setResolving] = useState<'upheld' | 'refused' | undefined>(
    undefined,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const look = appealStateLook(appeal.state);
  const decidable =
    appeal.state === 'received' || appeal.state === 'under_review';

  const resolve = (outcome: 'upheld' | 'refused') => {
    run(async () => {
      const result: ApiResult<unknown> = await api.resolveAppeal({
        appealId: appeal.id,
        expectedVersion: appeal.version,
        outcome,
      });
      const failure = failureMessage(result, {
        conflict:
          'This appeal changed since the page read it. Nothing was recorded. Reload and look at the current state.',
      });
      setMessage(failure);
      if (failure === undefined) {
        toast.show(
          outcome === 'upheld' ? 'Appeal upheld.' : 'Appeal refused.',
          'positive',
        );
      }
      onChanged();
    });
  };

  return (
    <>
      <tr data-testid={`appeal-${appeal.id}`}>
        <td className="a-mono">{shortId(appeal.id)}</td>
        <td className="a-mono a-quiet">{shortId(appeal.decisionId)}</td>
        <td>
          {/*
            Which side of the original decision the appellant was on. It is the
            most this console knows about them and the most it should.
          */}
          {appeal.appellantKind === 'subject'
            ? 'The subject'
            : 'The person who reported'}
        </td>
        <td>
          <Badge
            icon={look.icon}
            testId={`appeal-state-${appeal.id}`}
            tone={look.tone}
          >
            {look.label}
          </Badge>
        </td>
        <td className="a-numeric a-quiet">
          {formatDateTime(appeal.submittedAt)}
        </td>
        <td className="a-numeric a-quiet">
          {appeal.windowClosesAt === undefined
            ? '—'
            : formatRemaining(appeal.windowClosesAt)}
        </td>
        <td className="a-table__right">
          {decidable ? (
            <span className="a-inline a-inline--tight">
              <Button
                data-testid={`appeal-uphold-${appeal.id}`}
                disabled={busy}
                onClick={() => {
                  setAcknowledged(false);
                  setResolving('upheld');
                }}
                size="sm"
              >
                Uphold
              </Button>
              <Button
                data-testid={`appeal-refuse-${appeal.id}`}
                disabled={busy}
                onClick={() => {
                  setAcknowledged(false);
                  setResolving('refused');
                }}
                size="sm"
                tone="ghost"
              >
                Refuse
              </Button>
            </span>
          ) : (
            <span className="a-quiet">Settled</span>
          )}
        </td>
      </tr>

      {message === undefined ? null : (
        <tr>
          <td colSpan={7}>
            <ErrorMessage testId={`appeal-error-${appeal.id}`}>
              {message}
            </ErrorMessage>
          </td>
        </tr>
      )}

      {resolving === undefined ? null : (
        <tr>
          <td colSpan={7}>
            <ConfirmDialog
              busy={busy}
              cancelLabel="Cancel"
              confirmLabel={
                resolving === 'upheld'
                  ? 'Uphold the appeal'
                  : 'Refuse the appeal'
              }
              confirmTone={resolving === 'upheld' ? 'primary' : 'danger'}
              onCancel={() => {
                setResolving(undefined);
              }}
              onConfirm={() => {
                if (!acknowledged) return;
                const outcome = resolving;
                setResolving(undefined);
                resolve(outcome);
              }}
              testId="appeal-confirm"
              title={
                resolving === 'upheld'
                  ? 'Uphold this appeal?'
                  : 'Refuse this appeal?'
              }
            >
              <p>
                {resolving === 'upheld'
                  ? 'Upholding records that the original decision was wrong. It does not by itself undo the enforcement: a replacement decision on the case is what does that.'
                  : 'Refusing records that the original decision stands. The appellant is told the outcome and not the reasoning.'}
              </p>
              <Acknowledgement
                checked={acknowledged}
                onChange={setAcknowledged}
                testId="appeal-acknowledge"
              >
                I am recording this against appeal {shortId(appeal.id)} at
                version {appeal.version}.
              </Acknowledgement>
            </ConfirmDialog>
          </td>
        </tr>
      )}
    </>
  );
}
