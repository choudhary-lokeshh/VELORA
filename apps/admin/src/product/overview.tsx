'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import type { AdminOverview } from '../api/contract';
import {
  ErrorState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Scroller,
  Table,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { formatAge, formatDateTime, humanState, queueLabels } from './format';
import { useResource } from './resource';

/**
 * What needs a person right now.
 *
 * The one screen on this console that exists to answer a question rather than
 * to describe a subsystem, and the whole of it is counted work with somewhere
 * to go. Every tile is a link, because a number an operator cannot act on is a
 * number that decides nothing — and every tile is shown whether or not it has
 * anything in it, because "nothing is waiting" is an answer and a grid that
 * hid its empty tiles would change shape every time the platform did.
 *
 * **Every figure comes from the platform, over whole tables.** The console
 * could have added up the rows of the paged lists it already reads and would
 * have been approximately right, on the one screen where an operator decides
 * what to work on next. `/v1/admin/overview` exists so that it is exactly
 * right instead.
 *
 * There is no chart, no rate, no trend, no comparison with yesterday, and no
 * derived score anywhere here. Not one of those is published by the platform,
 * and each would be this console inventing a fact about the business on the
 * screen most likely to be believed.
 */

interface Tile {
  readonly caption: string;
  readonly count: number;
  readonly href: string;
  readonly id: string;
  /** Whether a figure above zero means somebody is owed work. */
  readonly waiting: boolean;
}

function tilesFor(value: AdminOverview): readonly Tile[] {
  const { attention } = value;
  return [
    {
      caption: 'Cases nobody has claimed',
      count: attention.casesUnclaimed,
      href: '/queues',
      id: 'cases-unclaimed',
      waiting: true,
    },
    {
      caption: 'Cases open in total',
      count: attention.casesOpen,
      href: '/queues',
      id: 'cases-open',
      waiting: false,
    },
    {
      caption: 'Appeals awaiting an answer',
      count: attention.appealsAwaiting,
      href: '/queues/appeals',
      id: 'appeals-awaiting',
      waiting: true,
    },
    {
      caption: 'Commercial records needing a person',
      count: attention.financialRecordsNeedingPerson,
      href: '/money',
      id: 'financial-attention',
      waiting: true,
    },
    {
      caption: 'Claims still live',
      count: attention.disputesOpen,
      href: '/money/disputes',
      id: 'disputes-open',
      waiting: true,
    },
    {
      caption: 'Payouts awaiting a provider answer',
      count: attention.payoutsAwaitingConfirmation,
      href: '/money/payouts',
      id: 'payouts-awaiting',
      waiting: true,
    },
    {
      caption: 'Creators under suspension',
      count: attention.creatorsSuspended,
      href: '/creators',
      id: 'creators-suspended',
      waiting: false,
    },
    {
      caption: 'Accounts under restriction',
      count: attention.accountsRestricted,
      href: '/accounts',
      id: 'accounts-restricted',
      waiting: false,
    },
  ];
}

export function Overview() {
  const api = useApi();
  const load = useCallback(async () => api.overview(), [api]);
  const state = useResource<AdminOverview>(load);
  const value = state.value;

  return (
    <>
      <PageHeader
        lede="What is waiting for somebody, counted by the platform over every record rather than over a page. Nothing here names anybody."
        title="Overview"
      />

      {state.error !== undefined && value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="overview-failed"
            />
          </PanelBody>
        </Panel>
      ) : value === undefined ? (
        <Panel testId="overview-loading">
          <PanelBody>
            <PanelSkeleton rows={4} />
          </PanelBody>
        </Panel>
      ) : (
        <>
          <Panel testId="overview-attention">
            <PanelHead
              actions={
                <span className="a-caption a-quiet a-numeric">
                  Read {formatDateTime(value.observedAt)}
                </span>
              }
              lede="Each of these is a total the platform computed, and each goes somewhere. A zero is an answer."
              title="Needs a person"
            />
            <PanelBody>
              <div className="a-attention">
                {tilesFor(value).map((tile) => (
                  <Link
                    className="a-attention__tile"
                    data-testid={`overview-${tile.id}`}
                    href={tile.href}
                    key={tile.id}
                  >
                    <span
                      className={`a-attention__value${
                        tile.waiting && tile.count > 0
                          ? ' a-attention__value--waiting'
                          : ''
                      }`}
                      data-testid={`overview-${tile.id}-count`}
                    >
                      {tile.count}
                    </span>
                    <span className="a-attention__caption">{tile.caption}</span>
                  </Link>
                ))}
              </div>
            </PanelBody>
          </Panel>

          {/*
            The oldest open case, as an age rather than only as a date. A
            timestamp asks an operator to do the subtraction; the age is the
            thing they were actually going to work out.
          */}
          <Panel testId="overview-oldest">
            <PanelHead
              lede="How long the platform has been holding the case nobody has settled."
              title="Oldest open case"
            />
            <PanelBody>
              {value.oldestOpenCaseAt === undefined ? (
                <p className="a-small a-muted" data-testid="overview-none-open">
                  No case is open anywhere on the platform.
                </p>
              ) : (
                <p className="a-small" data-testid="overview-oldest-age">
                  Opened{' '}
                  <span className="a-numeric">
                    {formatDateTime(value.oldestOpenCaseAt)}
                  </span>
                  , which is{' '}
                  <strong className="a-numeric">
                    {formatAge(
                      Math.max(
                        0,
                        Math.round(
                          (Date.parse(value.observedAt) -
                            Date.parse(value.oldestOpenCaseAt)) /
                            1000,
                        ),
                      ),
                    )}
                  </strong>{' '}
                  ago.
                </p>
              )}
            </PanelBody>
          </Panel>

          <div className="a-grid">
            <Grouping
              body="Open cases in the queue that owns them."
              labels={queueLabels}
              rows={value.casesByQueue}
              testId="overview-by-queue"
              title="Open cases by queue"
            />
            <Grouping
              body="Open cases at the urgency a reviewer set. Untriaged means nobody has looked yet."
              rows={value.casesByPriority}
              testId="overview-by-priority"
              title="Open cases by priority"
            />
          </div>
        </>
      )}
    </>
  );
}

/**
 * One grouping of open cases.
 *
 * No colour on any row. Priority is a judgement the platform published and is
 * toned where a case is shown; here the rows are a distribution rather than a
 * list of things to act on, and colouring a distribution would suggest that one
 * bar of it is the problem.
 */
function Grouping({
  body,
  labels,
  rows,
  testId,
  title,
}: {
  readonly body: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly rows: readonly { readonly count: number; readonly state: string }[];
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <Panel testId={testId}>
      <PanelHead lede={body} title={title} />
      {rows.length === 0 ? (
        <PanelBody>
          <p className="a-small a-muted" data-testid={`${testId}-empty`}>
            No case is open.
          </p>
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label={title}>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th className="a-table__right" scope="col">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.state}>
                    <td>{labels?.[row.state] ?? humanState(row.state)}</td>
                    <td className="a-table__right a-numeric">
                      <span data-testid={`${testId}-${row.state}`}>
                        {row.count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}
    </Panel>
  );
}
