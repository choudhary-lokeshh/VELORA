'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import type { ReconciliationState } from '../api/contract';
import {
  AreaNav,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Reference,
} from '../design/primitives';
import { moneyAreas } from '../app/navigation';
import { useApi } from '../app/providers';
import { formatDateTime, shortId } from './format';
import { useResource } from './resource';

/**
 * Whether the money adds up, and where it does not.
 *
 * Findings rather than alarms. Each one is a query with a published definition
 * — printed on the screen beside its count, because a number nobody can define
 * is a number nobody should act on — and each carries identifiers an operator
 * can open. There is no health percentage here and no severity score.
 *
 * A clean screen is the normal state and says so plainly. The alternative,
 * showing five green rows for five invariants that held, would train an
 * operator to skim past the one day it matters.
 */
export function MoneyReconciliation() {
  const api = useApi();
  const pathname = usePathname();
  const load = useCallback(async () => api.reconciliation(), [api]);
  const state = useResource<ReconciliationState>(load);

  return (
    <>
      <PageHeader
        lede="Every money invariant this platform can check, checked. Each finding says what it means and names records you can open."
        title="Money"
      />
      <AreaNav
        areas={moneyAreas}
        current={pathname}
        label="Money areas"
        testId="reconciliation-areas"
      />

      {state.error !== undefined && state.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="reconciliation-failed"
            />
          </PanelBody>
        </Panel>
      ) : state.value === undefined ? (
        <PanelSkeleton />
      ) : state.value.findings.length === 0 ? (
        <Panel testId="reconciliation-clean">
          <PanelHead
            actions={
              <span className="a-caption a-quiet a-numeric">
                as of {formatDateTime(state.value.observedAt)}
              </span>
            }
            title="Reconciliation"
          />
          <PanelBody>
            <EmptyState
              body="Every ledger transaction balances, every stored balance agrees with its entries, no payment is stuck, no coin hold has outlived its window, and no provider event is unprocessed."
              testId="reconciliation-empty"
              title="Nothing to reconcile"
            />
          </PanelBody>
        </Panel>
      ) : (
        state.value.findings.map((finding) => (
          <Panel key={finding.key} testId={`finding-${finding.key}`}>
            <PanelHead
              actions={
                <span className="a-caption a-numeric">{finding.total}</span>
              }
              title={finding.key}
            />
            <PanelBody>
              <p className="a-small a-muted">{finding.definition}</p>
              <ul className="a-stack a-stack--2">
                {finding.examples.map((example) => (
                  <li key={example}>
                    <Reference short={shortId(example)} value={example} />
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        ))
      )}
    </>
  );
}
