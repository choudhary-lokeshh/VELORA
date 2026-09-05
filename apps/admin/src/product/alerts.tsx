'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import type { OperationsState } from '../api/contract';
import { Notice, Panel, PanelBody, PanelHead } from '../design/primitives';
import { useApi } from '../app/providers';
import { formatDateTime, humanState } from './format';
import { useResource } from './resource';

/**
 * The conditions worth interrupting an operator for.
 *
 * Every alert here is a fact with a threshold that means something, not a
 * heuristic. A dependency the platform asked and could not reach is down. An
 * event nothing has delivered is stuck. A dead-lettered event is a fact that
 * was never published and will not be without somebody. Each of those is
 * actionable and each links to the screen that explains it.
 *
 * A provider seam nobody has approved is deliberately *not* an alert. Most of
 * VELORA's are switched off on purpose, and a console that treated those as
 * problems would show eight red rows every day until an operator stopped
 * reading the panel — which is exactly when the ninth one matters.
 *
 * Silence is the normal state and it says so. An alerts panel that always has
 * something in it is a decoration.
 */
export function OperationsAlerts({
  enabled = true,
}: {
  /**
   * Held until the screen's own read has answered.
   *
   * Two operator reads issued at once is two screens' worth of database work
   * from one page load, and ADR-0019's admission bound counts requests rather
   * than queries — so the cost of overlapping them lands on the product rather
   * than on this panel. Waiting costs an operator a few hundred milliseconds on
   * a panel they were not looking at yet.
   */
  readonly enabled?: boolean;
}) {
  const api = useApi();
  const load = useCallback(
    async () => api.operationsState({ hours: '24' }),
    [api],
  );
  const state = useResource<OperationsState>(load, { enabled });
  const value = state.value;

  // Deliberately silent while loading and silent on failure. An alerts panel
  // that announced its own inability to load would be the loudest thing on the
  // screen for a reason nobody can act on, and the Operations screen reports
  // that failure properly.
  if (value === undefined) return null;

  const unreachableQueues = value.queues.filter((queue) => !queue.reachable);
  const downDependencies = value.dependencies.filter(
    (dependency) => dependency.state === 'unavailable',
  );
  const deadLettered = value.outboxes.filter(
    (outbox) => outbox.deadLettered > 0,
  );
  const stuck = value.outboxes.filter((outbox) => outbox.pending > 0);
  const alerts =
    downDependencies.length +
    unreachableQueues.length +
    deadLettered.length +
    stuck.length;

  return (
    <Panel testId="overview-alerts">
      <PanelHead
        actions={
          <span className="a-caption a-quiet a-numeric">
            {formatDateTime(value.observedAt)}
          </span>
        }
        lede="Conditions the platform can prove, not thresholds somebody guessed. A seam nobody has approved is not an alert."
        title="Anything wrong"
      />
      <PanelBody>
        {alerts === 0 ? (
          <p className="a-small a-muted" data-testid="overview-alerts-clear">
            Nothing is unreachable, nothing is undelivered, and nothing has been
            dead-lettered.
          </p>
        ) : (
          <div className="a-stack a-stack--2">
            {downDependencies.map((dependency) => (
              <Notice
                key={dependency.name}
                testId={`alert-dependency-${dependency.name.replaceAll(' ', '-')}`}
                tone="critical"
              >
                {humanState(dependency.name)} did not answer.{' '}
                <Link href="/platform/operations">Operations</Link>
              </Notice>
            ))}
            {unreachableQueues.map((queue) => (
              <Notice
                key={queue.name}
                testId={`alert-queue-${queue.name}`}
                tone="critical"
              >
                The {queue.name} queue could not be reached, so its backlog is
                unknown rather than zero.{' '}
                <Link href="/platform/operations">Operations</Link>
              </Notice>
            ))}
            {deadLettered.map((outbox) => (
              <Notice
                key={`dead-${outbox.domain}`}
                testId={`alert-dead-${outbox.domain}`}
                tone="critical"
              >
                {String(outbox.deadLettered)} event(s) in{' '}
                {humanState(outbox.domain)} were never published and will not be
                without a person.{' '}
                <Link href="/platform/operations">Operations</Link>
              </Notice>
            ))}
            {stuck.map((outbox) => (
              <Notice
                key={`pending-${outbox.domain}`}
                testId={`alert-pending-${outbox.domain}`}
                tone="caution"
              >
                {String(outbox.pending)} event(s) in {humanState(outbox.domain)}{' '}
                are waiting to be delivered
                {outbox.oldestPendingAt === undefined
                  ? '.'
                  : `, the oldest since ${formatDateTime(outbox.oldestPendingAt)}.`}{' '}
                <Link href="/platform/operations">Operations</Link>
              </Notice>
            ))}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
