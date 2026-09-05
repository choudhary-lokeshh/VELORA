'use client';

import { useCallback, useState } from 'react';

import type { OperatorAction, OperatorActionList } from '../api/contract';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  Reference,
  RowSkeleton,
  Scroller,
  Select,
  Table,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { formatDateTime, humanState, shortId } from './format';
import { useCollection, type Page } from './resource';

/**
 * What operators did, including what they tried and were refused.
 *
 * Append-only, and structurally so: there is no route, service method, or
 * repository method anywhere in this platform that updates or deletes one of
 * these rows, and this module could not acquire one.
 *
 * A refusal is a row rather than an absence. An operator who tried to pause
 * live search and was told no — because somebody else had moved it, or because
 * they mistyped a reason — is a thing an incident review needs to see, and an
 * audit that recorded only successes would show the incident with a hole in the
 * middle of it. That is why `outcome` is a filter rather than a footnote.
 *
 * Every row carries what it was changing *from* as well as to. "Paused live
 * search" is a fact; "paused live search, which was on" is the fact an operator
 * reading this at 4am can act on.
 */

const outcomeOptions = [
  { label: 'Every outcome', value: '' },
  { label: 'Applied', value: 'applied' },
  { label: 'Refused', value: 'refused' },
  { label: 'Failed', value: 'failed' },
] as const;

const actionOptions = [
  { label: 'Every action', value: '' },
  { label: 'Control set', value: 'control.set' },
  { label: 'Sessions revoked', value: 'sessions.revoked' },
  { label: 'Role granted', value: 'operator.role.granted' },
  { label: 'Role revoked', value: 'operator.role.revoked' },
] as const;

const windowOptions = [
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
  { label: 'Last 30 days', value: '720' },
] as const;

function outcomeTone(
  outcome: OperatorAction['outcome'],
): 'positive' | 'critical' | 'neutral' {
  if (outcome === 'applied') return 'positive';
  if (outcome === 'failed') return 'critical';
  // A refusal is not a failure. The platform said no, on purpose.
  return 'neutral';
}

export function OperatorActions() {
  const api = useApi();
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [hours, setHours] = useState('168');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.operatorActions({
        cursor,
        hours,
        ...(action === ''
          ? {}
          : { action: action as OperatorAction['action'] }),
        ...(outcome === ''
          ? {}
          : { outcome: outcome as OperatorAction['outcome'] }),
      });
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: toPage(result.value) }
        : result;
    },
    [action, api, hours, outcome],
  );

  const collection = useCollection<OperatorAction, OperatorActionList>(load);

  return (
    <Panel testId="operator-actions">
      <PanelHead
        actions={
          collection.meta === undefined ? undefined : (
            <span className="a-caption a-quiet a-numeric">
              since {formatDateTime(collection.meta.since)}
            </span>
          )
        }
        title="Operator actions"
      />
      <PanelBody>
        <div className="a-toolbar">
          <Field label="Action">
            {(control) => (
              <Select
                {...control}
                data-testid="operator-actions-action"
                onChange={(event) => {
                  setAction(event.target.value);
                }}
                value={action}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Outcome">
            {(control) => (
              <Select
                {...control}
                data-testid="operator-actions-outcome"
                onChange={(event) => {
                  setOutcome(event.target.value);
                }}
                value={outcome}
              >
                {outcomeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Window">
            {(control) => (
              <Select
                {...control}
                data-testid="operator-actions-window"
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
      </PanelBody>

      {collection.error !== undefined && collection.items.length === 0 ? (
        <PanelBody>
          <ErrorState
            body={collection.error}
            onRetry={collection.retryable ? collection.reload : undefined}
            testId="operator-actions-failed"
          />
        </PanelBody>
      ) : collection.loading ? (
        <PanelBody>
          <RowSkeleton />
        </PanelBody>
      ) : collection.items.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="No operator changed anything in this window."
            testId="operator-actions-empty"
            title="Nothing recorded"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label="Operator actions">
            <Table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Change</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Operator</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {collection.items.map((entry) => (
                  <tr
                    data-testid={`operator-action-${entry.id}`}
                    key={entry.id}
                  >
                    <th className="a-numeric" scope="row">
                      {formatDateTime(entry.occurredAt)}
                    </th>
                    <td>{humanState(entry.action)}</td>
                    <td>
                      {entry.subjectId === undefined ? (
                        humanState(entry.subjectType)
                      ) : (
                        <Reference
                          short={shortId(entry.subjectId)}
                          value={entry.subjectId}
                        />
                      )}
                    </td>
                    <td className="a-caption a-quiet">
                      {entry.previousState === undefined &&
                      entry.requestedState === undefined
                        ? '—'
                        : `${entry.previousState ?? 'unset'} → ${
                            entry.requestedState ?? 'unset'
                          }`}
                    </td>
                    <td>
                      <Badge tone={outcomeTone(entry.outcome)}>
                        {humanState(entry.outcome)}
                      </Badge>
                    </td>
                    <td className="a-caption a-quiet">
                      {entry.actorReference}
                    </td>
                    <td className="a-caption a-quiet">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}

      {collection.hasMore ? (
        <PanelFoot>
          <Button
            busy={collection.loadingMore}
            data-testid="operator-actions-more"
            onClick={collection.loadMore}
          >
            Load more
          </Button>
        </PanelFoot>
      ) : null}
    </Panel>
  );
}

function toPage(
  value: OperatorActionList,
): Page<OperatorAction, OperatorActionList> {
  return {
    items: value.actions,
    meta: value,
    nextCursor: value.nextCursor,
  };
}
