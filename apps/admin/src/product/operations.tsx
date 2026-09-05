'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { OperationsState } from '../api/contract';
import {
  AreaNav,
  Badge,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Scroller,
  Select,
  Table,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi } from '../app/providers';
import { formatDateTime, humanState } from './format';
import { useResource } from './resource';

/**
 * What is stuck, what is failing, and what the platform could not ask.
 *
 * Every number here comes from a durable row somebody's domain wrote because
 * something went wrong, so a count is a set of records an operator can go and
 * open rather than a gauge. There is no health percentage on this screen, no
 * severity score, and no uptime figure — this platform has no monitoring
 * provider and inventing one of those would be the only thing here nobody could
 * check.
 *
 * Two distinctions the screen is built around, because they are the two an
 * operator most often gets wrong at three in the morning.
 *
 * **Unconfigured is not unavailable.** Most of VELORA's provider seams are
 * deliberately switched off — no approved payment provider, no approved
 * identity verifier — and showing those as failures would fill this screen with
 * alarms about decisions somebody made on purpose.
 *
 * **Unknown is not healthy.** A queue nothing could reach reports unreachable
 * with no counts rather than zeroes, and a remote provider this process has not
 * spoken to reports unknown. A zero for a broker nobody asked would be
 * reporting health with no evidence behind it.
 */

const windowOptions = [
  { label: 'Last hour', value: '1' },
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
] as const;

function dependencyTone(
  state: OperationsState['dependencies'][number]['state'],
): 'positive' | 'critical' | 'neutral' {
  if (state === 'healthy') return 'positive';
  if (state === 'unavailable') return 'critical';
  return 'neutral';
}

export function PlatformOperations() {
  const api = useApi();
  const pathname = usePathname();
  const [hours, setHours] = useState('24');
  const load = useCallback(
    async () => api.operationsState({ hours }),
    [api, hours],
  );
  const state = useResource<OperationsState>(load);

  return (
    <>
      <PageHeader
        lede="Stuck work, recorded failures, queue counters, and every dependency's readiness. Nothing here is a score."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="operations-areas"
      />

      {state.error !== undefined && state.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="operations-failed"
            />
          </PanelBody>
        </Panel>
      ) : state.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          <div className="a-toolbar">
            <Field label="Window">
              {(control) => (
                <Select
                  {...control}
                  data-testid="operations-window"
                  onChange={(event) => {
                    setHours(event.target.value);
                  }}
                  value={hours}
                >
                  {windowOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Panel testId="operations-dependencies">
            <PanelHead
              actions={
                <span className="a-caption a-quiet a-numeric">
                  as of {formatDateTime(state.value.observedAt)}
                </span>
              }
              title="Dependencies"
            />
            <PanelBody flush>
              <Scroller label="Dependencies">
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Dependency</th>
                      <th scope="col">Adapter</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.value.dependencies.map((entry) => (
                      <tr
                        data-testid={`dependency-${entry.name.replaceAll(' ', '-')}`}
                        key={entry.name}
                      >
                        <th scope="row">{humanState(entry.name)}</th>
                        <td className="a-caption a-quiet">
                          {entry.adapter ?? '—'}
                        </td>
                        <td>
                          <Badge tone={dependencyTone(entry.state)}>
                            {humanState(entry.state)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Scroller>
            </PanelBody>
          </Panel>

          <Panel testId="operations-queues">
            <PanelHead title="Job queues" />
            {state.value.queues.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="This API process holds no queue client, so nothing asked. That is different from a queue reporting zero."
                  testId="operations-queues-empty"
                  title="Not observed here"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Job queues">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Queue</th>
                        <th className="a-table__right" scope="col">
                          Waiting
                        </th>
                        <th className="a-table__right" scope="col">
                          Active
                        </th>
                        <th className="a-table__right" scope="col">
                          Delayed
                        </th>
                        <th className="a-table__right" scope="col">
                          Failed
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.value.queues.map((queue) => (
                        <tr
                          data-testid={`queue-${queue.name}`}
                          key={queue.name}
                        >
                          <th scope="row">
                            {queue.name}
                            {queue.reachable ? null : (
                              <>
                                {' '}
                                · <Badge tone="critical">Unreachable</Badge>
                              </>
                            )}
                          </th>
                          <td className="a-table__right a-numeric">
                            {queue.waiting ?? '—'}
                          </td>
                          <td className="a-table__right a-numeric">
                            {queue.active ?? '—'}
                          </td>
                          <td className="a-table__right a-numeric">
                            {queue.delayed ?? '—'}
                          </td>
                          <td className="a-table__right a-numeric">
                            {queue.failed ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>

          <Panel testId="operations-outboxes">
            <PanelHead title="Undelivered domain events" />
            <PanelBody flush>
              <Scroller label="Outboxes">
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Domain</th>
                      <th className="a-table__right" scope="col">
                        Pending
                      </th>
                      <th className="a-table__right" scope="col">
                        Dead-lettered
                      </th>
                      <th scope="col">Oldest pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.value.outboxes.map((outbox) => (
                      <tr
                        data-testid={`outbox-${outbox.domain}`}
                        key={outbox.domain}
                      >
                        <th scope="row">{humanState(outbox.domain)}</th>
                        <td className="a-table__right a-numeric">
                          {outbox.pending}
                        </td>
                        <td className="a-table__right a-numeric">
                          {outbox.deadLettered}
                        </td>
                        <td className="a-numeric a-caption a-quiet">
                          {outbox.oldestPendingAt === undefined
                            ? '—'
                            : formatDateTime(outbox.oldestPendingAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Scroller>
            </PanelBody>
          </Panel>

          <Panel testId="operations-failures">
            <PanelHead
              actions={
                <span className="a-caption a-quiet a-numeric">
                  since {formatDateTime(state.value.since)}
                </span>
              }
              title="Recorded failures"
            />
            {state.value.failures.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="No domain recorded a failure in this window."
                  testId="operations-failures-empty"
                  title="Nothing failed"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Failures">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Domain</th>
                        <th scope="col">Class</th>
                        <th className="a-table__right" scope="col">
                          Count
                        </th>
                        <th scope="col">Latest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.value.failures.map((failure) => (
                        <tr
                          data-testid={`failure-${failure.domain}-${failure.category}`}
                          key={`${failure.domain}:${failure.category}`}
                        >
                          <th scope="row">{humanState(failure.domain)}</th>
                          <td>{humanState(failure.category)}</td>
                          <td className="a-table__right a-numeric">
                            {failure.total}
                          </td>
                          <td className="a-numeric a-caption a-quiet">
                            {formatDateTime(failure.latestAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
