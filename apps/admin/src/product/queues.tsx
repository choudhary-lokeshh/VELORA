'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import type { ModerationQueue, SafetyCase } from '../api/contract';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  RowSkeleton,
  Scroller,
  Segmented,
  Table,
  Toolbar,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  casePriorityLook,
  caseStateLabels,
  formatDateTime,
  formatRemaining,
  humanState,
  plural,
  queueLabels,
  shortId,
  targetTypeLabels,
} from './format';
import { useCollection } from './resource';

/**
 * The operator's own work.
 *
 * A moderation case is the unit of work on this platform, and the list is
 * deliberately a table rather than a deck of cards: the question an operator
 * opens this page with is which of these is different from the others, and that
 * is a question about columns.
 *
 * Nothing here shows who anybody is. A case carries a target type and a target
 * identifier, and the identifier is opaque — MODERATION publishes no name, no
 * handle, and no content, and a queue that displayed them would be a browsing
 * surface over the people who were reported.
 *
 * The queue filter goes to the server rather than filtering what has arrived,
 * because the list is keyset-paged and a filter applied to one page would be a
 * filter that quietly hid the rest of somebody's work.
 */

const casePageSize = 25;

type QueueFilter = 'all' | ModerationQueue;

const queueOptions: readonly { label: string; value: QueueFilter }[] = [
  { label: 'Every queue', value: 'all' },
  { label: 'Consumer conduct', value: 'consumer_conduct' },
  { label: 'Creator content', value: 'creator_content' },
  { label: 'Creator identity', value: 'creator_identity' },
];

export function Queues() {
  const api = useApi();
  const [queue, setQueue] = useState<QueueFilter>('all');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.cases({
        cursor,
        ...(queue === 'all' ? {} : { moderationQueue: queue }),
        pageSize: casePageSize,
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.cases,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, queue],
  );
  const cases = useCollection<SafetyCase>(load);

  return (
    <>
      <Toolbar>
        <Segmented
          label="Filter by queue"
          onChange={setQueue}
          options={queueOptions}
          value={queue}
        />
        <ButtonLink data-testid="queues-appeals" href="/queues/appeals">
          Appeals
        </ButtonLink>
      </Toolbar>

      <Panel testId="case-list">
        <PanelHead
          actions={
            cases.items.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(cases.items.length, 'case loaded', 'cases loaded')}
                {cases.hasMore ? ', more to come' : ''}
              </span>
            )
          }
          lede="Opened cases in the order the platform holds them. Nothing here names anybody."
          title="Cases"
        />

        {cases.error !== undefined && cases.items.length === 0 ? (
          <PanelBody>
            <ErrorState
              body={cases.error}
              onRetry={cases.retryable ? cases.reload : undefined}
              testId="case-list-failed"
            />
          </PanelBody>
        ) : cases.loading && cases.items.length === 0 ? (
          <PanelBody>
            <RowSkeleton rows={5} />
          </PanelBody>
        ) : cases.items.length === 0 ? (
          <PanelBody>
            <EmptyState
              body={
                queue === 'all'
                  ? 'No case is open anywhere on the platform.'
                  : 'No case is open in that queue. Another queue may still have work.'
              }
              testId="case-list-empty"
              title="Nothing waiting"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Cases">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Queue</th>
                    <th scope="col">Priority</th>
                    <th scope="col">State</th>
                    <th scope="col">Target</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Assignment</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.items.map((entry) => (
                    <CaseRow entry={entry} key={entry.id} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}

        {cases.hasMore ? (
          <PanelFoot>
            <Button
              block
              busy={cases.loadingMore}
              data-testid="case-list-more"
              onClick={cases.loadMore}
            >
              Load more
            </Button>
          </PanelFoot>
        ) : null}
      </Panel>
    </>
  );
}

function CaseRow({ entry }: { readonly entry: SafetyCase }) {
  const priority = casePriorityLook(entry.priority);
  return (
    <tr data-testid={`case-${entry.id}`}>
      <td>
        <Link className="a-table__link a-mono" href={`/queues/${entry.id}`}>
          {shortId(entry.id)}
        </Link>
      </td>
      <td>{queueLabels[entry.queue] ?? humanState(entry.queue)}</td>
      <td>
        <Badge
          icon={priority.icon}
          testId={`case-priority-${entry.id}`}
          tone={priority.tone}
        >
          {priority.label}
        </Badge>
      </td>
      <td>{caseStateLabels[entry.state] ?? humanState(entry.state)}</td>
      <td>
        {targetTypeLabels[entry.targetType] ?? humanState(entry.targetType)}
      </td>
      <td className="a-numeric a-quiet">{formatDateTime(entry.openedAt)}</td>
      <td>
        {/*
          Whether somebody already holds this case, and for how much longer.
          An assignment that has expired is work nobody is doing, which is
          exactly what a queue exists to surface.
        */}
        {entry.assigned ? (
          <Badge icon="clock" tone="info">
            {entry.assignmentExpiresAt === undefined
              ? 'Claimed'
              : `Claimed, ${formatRemaining(entry.assignmentExpiresAt)}`}
          </Badge>
        ) : (
          <span className="a-quiet">Unclaimed</span>
        )}
      </td>
    </tr>
  );
}
