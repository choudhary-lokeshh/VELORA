'use client';

import { useCallback } from 'react';

import type { AdminAuditEntry, AdminAuditStream } from '../api/contract';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  Reference,
  RowSkeleton,
  Timeline,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  decisionActionLabels,
  enforcementReasonLabels,
  formatDateTime,
  humanState,
  plural,
  shortId,
  targetTypeLabels,
} from './format';
import { useCollection } from './resource';

/**
 * What has happened, from whichever record keeps it.
 *
 * Two append-only records, one shape. **Security** is AUTH's own event log:
 * every authentication, session, and recovery event the platform saw, with an
 * enumerated type and an enumerated reason and no free-form payload to leak
 * into. **Decisions** is TRUST & SAFETY's settled record: what an operator did,
 * under which reason, against which kind of target.
 *
 * Neither is browsed as a person. A security event carries no account — an
 * operator reading an authentication trail does not need to know whose it is,
 * and a console that joined it would be an account browser wearing an audit
 * label. A decision carries the session that made it rather than a name,
 * because an audit has to identify the act deterministically and does not need
 * to identify the actor to do that.
 *
 * **Nothing here is toned.** A colour on an audit row would be this console
 * deciding which of the platform's own records is the bad one, and one domain's
 * "failed" is another's ordinary retry. Where the platform published a
 * judgement — a case's priority, a creator's standing — the console colours it;
 * an event log publishes none.
 *
 * Read only, and structurally so: these tables are append-only in the database,
 * the contract offers no write against either, and this module has no path that
 * could acquire one.
 */

const auditPageSize = 30;

function entryOf(entry: AdminAuditEntry) {
  const what =
    entry.stream === 'decision'
      ? (decisionActionLabels[entry.what] ?? humanState(entry.what))
      : humanState(entry.what);
  const outcome =
    entry.outcome === undefined
      ? undefined
      : entry.stream === 'decision'
        ? (enforcementReasonLabels[entry.outcome] ?? humanState(entry.outcome))
        : humanState(entry.outcome);

  return {
    detail:
      entry.stream === 'decision' ? (
        <>
          {entry.subjectType === undefined
            ? 'Against a target the record does not classify'
            : `Against a ${(
                targetTypeLabels[entry.subjectType] ??
                humanState(entry.subjectType)
              ).toLowerCase()}`}
          {outcome === undefined ? '' : ` · ${outcome}`}
        </>
      ) : (
        outcome
      ),
    id: entry.id,
    meta:
      entry.stream === 'decision' ? (
        entry.actorReference === undefined ? undefined : (
          <Reference
            short={shortId(entry.actorReference)}
            value={entry.actorReference}
          />
        )
      ) : entry.audience === undefined ? undefined : (
        <span className="a-mono">{humanState(entry.audience)}</span>
      ),
    title: what,
    when: formatDateTime(entry.occurredAt),
  };
}

export function Audit({
  emptyBody,
  emptyTitle,
  lede,
  stream,
  title,
}: {
  readonly emptyBody: string;
  readonly emptyTitle: string;
  readonly lede: string;
  readonly stream: AdminAuditStream;
  readonly title: string;
}) {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.audit({
        cursor,
        pageSize: auditPageSize,
        stream,
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.entries,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, stream],
  );
  const entries = useCollection<AdminAuditEntry>(load);

  return (
    <>
      <Panel testId={`audit-${stream}`}>
        <PanelHead
          actions={
            entries.items.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(entries.items.length, 'entry loaded', 'entries loaded')}
                {entries.hasMore ? ', more to come' : ''}
              </span>
            )
          }
          lede={lede}
          title={title}
        />

        {entries.error !== undefined && entries.items.length === 0 ? (
          <PanelBody>
            <ErrorState
              body={entries.error}
              onRetry={entries.retryable ? entries.reload : undefined}
              testId={`audit-${stream}-failed`}
            />
          </PanelBody>
        ) : entries.loading && entries.items.length === 0 ? (
          <PanelBody>
            <RowSkeleton rows={6} />
          </PanelBody>
        ) : entries.items.length === 0 ? (
          <PanelBody>
            <EmptyState
              body={emptyBody}
              testId={`audit-${stream}-empty`}
              title={emptyTitle}
            />
          </PanelBody>
        ) : (
          <PanelBody>
            <Timeline
              entries={entries.items.map((entry) => entryOf(entry))}
              testId={`audit-${stream}-entries`}
            />
          </PanelBody>
        )}

        {entries.hasMore ? (
          <PanelFoot>
            <Button
              block
              busy={entries.loadingMore}
              data-testid={`audit-${stream}-more`}
              onClick={entries.loadMore}
            >
              Load more
            </Button>
          </PanelFoot>
        ) : null}
      </Panel>

      <Notice
        icon="lock"
        testId={`audit-${stream}-scope`}
        title="What this record does not hold"
      >
        {stream === 'security'
          ? 'No account, no address, no device, no token, and no free-form text. AUTH records an enumerated event type and an enumerated reason, and there is no field in the table for anything else to end up in.'
          : "No report, no evidence, and no narrative. A decision's own case holds those, beside the material it rests on, which is the only place they can honestly be read."}
      </Notice>
    </>
  );
}
