'use client';

import type { ReactNode } from 'react';

import type { Backlog, StateCount } from '../api/contract';
import { Icon } from '../design/icons';
import {
  Badge,
  EmptyState,
  Fact,
  Facts,
  Panel,
  PanelBody,
  PanelHead,
  Scroller,
  Table,
} from '../design/primitives';
import { formatAge, humanState, plural, totalOf } from './format';

/**
 * The three shapes every operational read is made of.
 *
 * MEDIA, NOTIFICATIONS, RTC, IDENTITY, and BILLING each publish counts by
 * state, most of them publish owed work with an age and a threshold, and each
 * publishes which adapters this process actually composed. Rendering those the
 * same way every time is the point: an operator comparing two subsystems at
 * three in the morning should not have to learn two tables.
 */

/* ============================ Counts by state ======================== */

/**
 * How many things are in each state a domain publishes.
 *
 * The state is humanised and never reinterpreted, and no row carries a colour.
 * It would be easy to tone a row red because its state contains "failed", and
 * easy to be wrong: one domain's `failed` is terminal and another's is retried
 * in ninety seconds. The only judgements this console colours are the ones the
 * contract publishes as judgements.
 */
export function StateCounts({
  emptyBody,
  emptyTitle,
  rows,
  testId,
  title,
  what,
}: {
  readonly emptyBody?: string;
  readonly emptyTitle?: string;
  readonly rows: readonly StateCount[];
  readonly testId: string;
  readonly title: ReactNode;
  /** What one row counts, so the total says what it is a total of. */
  readonly what: readonly [string, string];
}) {
  const total = totalOf(rows);
  return (
    <Panel testId={testId}>
      <PanelHead
        actions={
          rows.length === 0 ? undefined : (
            <span className="a-caption a-quiet a-numeric">
              {plural(total, what[0], what[1])}
            </span>
          )
        }
        title={title}
      />
      {rows.length === 0 ? (
        <PanelBody>
          <EmptyState
            body={emptyBody}
            testId={`${testId}-empty`}
            title={emptyTitle ?? 'Nothing in any state'}
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label={typeof title === 'string' ? title : testId}>
            <Table>
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th className="a-table__right" scope="col">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.state}>
                    <td>{humanState(row.state)}</td>
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

/* =============================== Backlogs ============================ */

/**
 * Owed work, with the age of its oldest member and the age at which the owning
 * domain says that becomes an alert.
 *
 * Every class is shown every time, healthy ones included: a panel that listed
 * only what was wrong could not tell "nothing is owed" apart from "the signal
 * stopped arriving". A class with nothing in it says so rather than reporting
 * an age of zero.
 *
 * `breached` is the domain's own judgement, computed from the deadlines its
 * sweeps actually run on, so this is one of the few places on the console where
 * a colour is honest.
 */
export function Backlogs({
  rows,
  testId,
  title,
}: {
  readonly rows: readonly Backlog[];
  readonly testId: string;
  readonly title: ReactNode;
}) {
  const breached = rows.filter((row) => row.breached).length;
  return (
    <Panel testId={testId}>
      <PanelHead
        actions={
          breached === 0 ? (
            <Badge icon="check" testId={`${testId}-healthy`} tone="positive">
              Within threshold
            </Badge>
          ) : (
            <Badge icon="alert" testId={`${testId}-breached`} tone="critical">
              {plural(breached, 'class late', 'classes late')}
            </Badge>
          )
        }
        lede="The oldest item in each class, against the age its owning domain calls late."
        title={title}
      />
      {rows.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="This subsystem publishes no owed-work classes."
            testId={`${testId}-empty`}
            title="Nothing owed"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label={typeof title === 'string' ? title : testId}>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th className="a-table__right" scope="col">
                    Owed
                  </th>
                  <th className="a-table__right" scope="col">
                    Oldest
                  </th>
                  <th className="a-table__right" scope="col">
                    Late after
                  </th>
                  <th scope="col">
                    <span className="a-visually-hidden">Judgement</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr data-testid={`${testId}-${row.state}`} key={row.state}>
                    <td>{humanState(row.state)}</td>
                    <td className="a-table__right a-numeric">{row.count}</td>
                    <td className="a-table__right a-numeric">
                      {/*
                        A class with nothing in it has no oldest member. Saying
                        so beats reporting an age of zero, which reads as "one
                        item, brand new".
                      */}
                      {row.count === 0 || row.oldestAgeSeconds === undefined
                        ? '—'
                        : formatAge(row.oldestAgeSeconds)}
                    </td>
                    <td className="a-table__right a-numeric a-quiet">
                      {formatAge(row.thresholdSeconds)}
                    </td>
                    <td>
                      {row.breached ? (
                        <Badge icon="alert" tone="critical">
                          Late
                        </Badge>
                      ) : (
                        <span className="a-visually-hidden">
                          Within threshold
                        </span>
                      )}
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

/* =============================== Adapters ============================ */

/**
 * Which implementation this process actually composed for each seam.
 *
 * Reported as the adapter's own name rather than as a boolean, because "off"
 * and "off because nobody has approved one" are different situations and an
 * operator seeing `unavailable` across the row is seeing the second. The name
 * is the platform's own vocabulary and is printed verbatim; a provider's
 * commercial name is not a thing this console invents.
 */
export function Adapters({
  rows,
  testId,
  title = 'Composed adapters',
}: {
  readonly rows: Readonly<Record<string, string>>;
  readonly testId: string;
  readonly title?: string;
}) {
  const entries = Object.entries(rows).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <Panel testId={testId}>
      <PanelHead
        lede="What this process composed, not what a configuration file asked for."
        title={title}
      />
      <PanelBody>
        <Facts>
          {entries.map(([name, adapter]) => (
            <Fact
              key={name}
              term={humanState(name)}
              testId={`${testId}-${name}`}
              value={<span className="a-mono">{adapter}</span>}
            />
          ))}
        </Facts>
      </PanelBody>
    </Panel>
  );
}

/* ============================== Availability ========================= */

/**
 * Whether a subsystem can do its job in this environment at all.
 *
 * A single published boolean, stated in one sentence. It is the first thing an
 * operator needs and the thing a table of counts cannot say: a media platform
 * with nothing owed and nothing accepted is not the same as an idle one.
 */
export function Availability({
  available,
  availableTitle,
  children,
  testId,
  unavailableTitle,
}: {
  readonly available: boolean;
  readonly availableTitle: string;
  readonly children: ReactNode;
  readonly testId: string;
  readonly unavailableTitle: string;
}) {
  return (
    <div
      className={`a-notice a-notice--${available ? 'info' : 'quiet'}`}
      data-testid={testId}
    >
      <span className="a-notice__icon">
        <Icon name={available ? 'check' : 'lock'} size="md" />
      </span>
      <div className="a-notice__body">
        <p className="a-subheading">
          {available ? availableTitle : unavailableTitle}
        </p>
        <div className="a-small a-muted">{children}</div>
      </div>
    </div>
  );
}
