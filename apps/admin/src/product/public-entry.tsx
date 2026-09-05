'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import type { PublicEntryState } from '../api/contract';
import {
  AreaNav,
  Badge,
  ErrorState,
  Fact,
  Facts,
  Metric,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi } from '../app/providers';
import { formatDateTime } from './format';
import { useResource } from './resource';

/**
 * Whether VELORA has a way in, and what is behind it.
 *
 * Two conditions decide whether anything is indexable — the environment has to
 * be production and a canonical public origin has to be configured — and both
 * are shown rather than collapsed into a yes or no. An operator who is told
 * only "not indexed" cannot tell that from "indexed, and nobody is coming",
 * and those need completely different responses.
 *
 * The counts are of addresses that actually exist: published creator pages
 * belonging to active creators, published clubs, and scheduled windows. They
 * are counted with the same conditions the public reads apply, so the number is
 * the size of the sitemap rather than the number of rows that could one day
 * become one.
 *
 * There is no rank, impression, click, or traffic figure anywhere here. This
 * platform has no search console and no analytics provider, and a number
 * invented to fill the space would be the only thing on this screen nobody
 * could check.
 */
export function PlatformPublicEntry() {
  const api = useApi();
  const pathname = usePathname();
  const load = useCallback(async () => api.publicEntry(), [api]);
  const state = useResource<PublicEntryState>(load);

  return (
    <>
      <PageHeader
        lede="What an anonymous visitor can reach, and whether a search engine is allowed to keep it."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="public-entry-areas"
      />

      {state.error !== undefined && state.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="public-entry-failed"
            />
          </PanelBody>
        </Panel>
      ) : state.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          {state.value.indexable ? null : (
            <Notice testId="public-entry-not-indexable" tone="info">
              Nothing on this platform is indexable, and that is correct here:{' '}
              {state.value.environment === 'production'
                ? 'no canonical public origin is configured, so no page can carry a canonical link.'
                : `this is the ${state.value.environment} environment, which serves fixtures and seeded people.`}
            </Notice>
          )}

          <Panel testId="public-entry-state">
            <PanelHead
              actions={
                <Badge tone={state.value.indexable ? 'positive' : 'neutral'}>
                  {state.value.indexable ? 'Indexable' : 'Not indexable'}
                </Badge>
              }
              title="Public identity"
            />
            <PanelBody>
              <Facts>
                <Fact term="Environment" value={state.value.environment} />
                <Fact
                  term="Canonical origin"
                  value={state.value.canonicalOrigin ?? 'Not configured'}
                />
                <Fact
                  term="Observed"
                  value={formatDateTime(state.value.observedAt)}
                />
              </Facts>
            </PanelBody>
          </Panel>

          <div className="a-grid a-grid--narrow">
            <Panel testId="public-entry-creators">
              <PanelHead title="Creator pages published" />
              <PanelBody>
                <Metric
                  caption="published, by a creator whose account is active"
                  testId="public-entry-creators-count"
                  value={state.value.publishedCreators}
                />
              </PanelBody>
            </Panel>
            <Panel testId="public-entry-clubs">
              <PanelHead title="Clubs published" />
              <PanelBody>
                <Metric
                  caption="published and not closed"
                  testId="public-entry-clubs-count"
                  value={state.value.publishedClubs}
                />
              </PanelBody>
            </Panel>
            <Panel testId="public-entry-windows">
              <PanelHead title="Scheduled live windows" />
              <PanelBody>
                <Facts>
                  <Fact
                    term="Upcoming"
                    value={state.value.liveWindows.upcoming}
                  />
                  <Fact
                    term="Running now"
                    value={state.value.liveWindows.active}
                  />
                  <Fact
                    term="Cancelled"
                    value={state.value.liveWindows.cancelled}
                  />
                </Facts>
              </PanelBody>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
