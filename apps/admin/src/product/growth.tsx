'use client';

import { useCallback, useState } from 'react';

import type {
  AcquisitionSummary,
  LiveWindow,
  LiveWindowList,
} from '../api/contract';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Metric,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  PanelSkeleton,
  Scroller,
  StatusMessage,
  Table,
  TextInput,
} from '../design/primitives';
import { AreaNav } from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { usePathname } from 'next/navigation';
import { useApi } from '../app/providers';
import { useResource } from './resource';

/**
 * Acquisition, and the two controls an operator actually needs.
 *
 * What is here: how many invitations were made, how many were opened, how many
 * signups each channel produced, and the times VELORA is asking people to be
 * looking at once.
 *
 * What is deliberately not here, and could not be added from this file because
 * the contract has no shape for it: who invited whom, how many people any one
 * person brought, and any conversion rate. The first two would hand an operator
 * a social graph they have no decision to make about — every reward scheme ever
 * attached to that number ended with people buying accounts — and the third
 * would be a figure GROWTH cannot compute honestly, because whether an
 * attributed account went on to use the product is USERS' and LIVE's fact.
 *
 * Nothing on this screen identifies anybody, and nothing on it is a percentage.
 */
export function PlatformGrowth() {
  const api = useApi();
  const pathname = usePathname();
  const load = useCallback(async () => api.acquisitionSummary(), [api]);
  const summary = useResource<AcquisitionSummary>(load);

  return (
    <>
      <PageHeader
        lede="How people are arriving, in counts GROWTH owns. Nobody is named here, and no figure on this screen is a rate."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="growth-areas"
      />
      {summary.error !== undefined && summary.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={summary.error}
              onRetry={summary.retryable ? summary.reload : undefined}
              testId="growth-failed"
            />
          </PanelBody>
        </Panel>
      ) : summary.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          <div className="a-grid a-grid--narrow">
            <Panel testId="growth-invites">
              <PanelHead title="Invitations made" />
              <PanelBody>
                <Metric
                  caption={`since ${dayOf(summary.value.since)}`}
                  testId="growth-invites-count"
                  value={summary.value.invitesCreated}
                />
              </PanelBody>
            </Panel>
            <Panel testId="growth-openings">
              <PanelHead title="Invitations opened" />
              <PanelBody>
                <Metric
                  caption="one per visitor, however many times they refreshed"
                  testId="growth-openings-count"
                  value={summary.value.invitationsOpened}
                />
              </PanelBody>
            </Panel>
            <Panel testId="growth-signups">
              <PanelHead title="Signups attributed" />
              <PanelBody>
                <Metric
                  caption="every account created in the window has exactly one origin"
                  testId="growth-signups-count"
                  value={summary.value.signupsAttributed}
                />
              </PanelBody>
            </Panel>
          </div>

          <Panel testId="growth-sources">
            <PanelHead title="Where signups came from" />
            <PanelBody>
              {summary.value.sources.length === 0 ? (
                <EmptyState
                  body="No account has been created in this window."
                  testId="growth-sources-empty"
                  title="Nothing to count yet"
                />
              ) : (
                <Scroller label="Signups by source">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th className="a-table__right" scope="col">
                          Signups
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.value.sources.map((entry) => (
                        <tr key={entry.source}>
                          <td>{sourceLabel(entry.source)}</td>
                          <td className="a-table__right">{entry.signups}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              )}
            </PanelBody>
          </Panel>
        </>
      )}

      <LiveWindows onChanged={summary.reload} />
    </>
  );
}

/**
 * The scheduled times, and the two acts that change them.
 *
 * A window is an announcement that more people intend to be looking between two
 * instants. It has no attendee count here for the same reason it has none in
 * the contract: nothing knows, and a number an operator could read as
 * attendance would be the one dishonest figure on an otherwise honest screen.
 */
function LiveWindows({ onChanged }: { readonly onChanged: () => void }) {
  const api = useApi();
  const load = useCallback(async () => api.liveWindows(), [api]);
  const published = useResource<LiveWindowList>(load);
  const [applied, setApplied] = useState<readonly LiveWindow[] | undefined>(
    undefined,
  );
  const windows = applied ?? published.value?.windows;
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const apply = (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    void work().finally(() => {
      setBusy(false);
      onChanged();
    });
  };

  return (
    <Panel testId="growth-windows">
      <PanelHead title="Live windows" />
      <PanelBody>
        {message === undefined ? null : (
          <StatusMessage testId="growth-windows-message">
            {message}
          </StatusMessage>
        )}
        {windows === undefined ? (
          <EmptyState
            body="Schedule one below, or apply an existing slug again to move it."
            testId="growth-windows-unread"
            title="Nothing read yet"
          />
        ) : windows.length === 0 ? (
          <EmptyState
            body="Ordinary Live is unaffected: people can meet at any hour, and always could."
            testId="growth-windows-empty"
            title="No window is published"
          />
        ) : (
          <Scroller label="Scheduled live windows">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Window</th>
                  <th scope="col">Address</th>
                  <th scope="col">State</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Ends</th>
                  <th scope="col">
                    <span className="a-visually-hidden">Withdraw</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {windows.map((window) => (
                  <tr key={window.slug}>
                    <td>{window.title}</td>
                    <td>{`/live-window/${window.slug}`}</td>
                    <td>{window.state}</td>
                    <td>{momentOf(window.startsAt)}</td>
                    <td>{momentOf(window.endsAt)}</td>
                    <td>
                      <Button
                        busy={busy}
                        onClick={() => {
                          apply(async () => {
                            const result = await api.cancelLiveWindow(
                              window.slug,
                            );
                            if (result.kind === 'ok') {
                              setApplied(result.value.windows);
                              return;
                            }
                            setMessage('That window could not be withdrawn.');
                          });
                        }}
                        data-testid={`growth-window-cancel-${window.slug}`}
                      >
                        Withdraw
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        )}
      </PanelBody>
      <PanelFoot>
        <div className="a-grid a-grid--narrow">
          <Field
            hint="Lowercase letters, digits and hyphens. It becomes the shareable address."
            label="Address"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="growth-window-slug"
                onChange={(event) => {
                  setSlug(event.target.value);
                }}
                value={slug}
              />
            )}
          </Field>
          <Field label="Name">
            {(control) => (
              <TextInput
                {...control}
                data-testid="growth-window-title"
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                value={title}
              />
            )}
          </Field>
          <Field hint="Your own time zone. Stored in UTC." label="Starts">
            {(control) => (
              <TextInput
                {...control}
                data-testid="growth-window-starts"
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
                type="datetime-local"
                value={startsAt}
              />
            )}
          </Field>
          <Field hint="No more than a day after it starts." label="Ends">
            {(control) => (
              <TextInput
                {...control}
                data-testid="growth-window-ends"
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
                type="datetime-local"
                value={endsAt}
              />
            )}
          </Field>
        </div>
        <Button
          busy={busy}
          onClick={() => {
            const starts = instantOf(startsAt);
            const ends = instantOf(endsAt);
            if (starts === undefined || ends === undefined) {
              setMessage('Both a start and an end are needed.');
              return;
            }
            apply(async () => {
              const result = await api.scheduleLiveWindow({
                endsAt: ends,
                slug,
                startsAt: starts,
                title,
              });
              if (result.kind === 'ok') {
                setApplied(result.value.windows);
                return;
              }
              setMessage(
                'That window was refused. A window must end after it starts and run for no more than a day.',
              );
            });
          }}
          data-testid="growth-window-schedule"
          tone="primary"
        >
          Schedule
        </Button>
      </PanelFoot>
    </Panel>
  );
}

/**
 * `invite` and `direct` are the platform's own words; anything else is a label
 * somebody put in a link and is shown as it was stored.
 */
function sourceLabel(source: string): string {
  if (source === 'invite') return 'An invitation';
  if (source === 'direct') return 'Direct';
  return source;
}

/** A date, in the operator's own zone, with no time on it. */
function dayOf(value: string): string {
  return new Date(value).toLocaleDateString();
}

function momentOf(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * A `datetime-local` value as an instant.
 *
 * The control answers in the operator's own zone with no offset on it, so the
 * browser's own `Date` is what turns it into one. An unparseable value is
 * refused here rather than sent, because the server would answer 422 and the
 * operator would have to guess which of four fields it meant.
 */
function instantOf(value: string): string | undefined {
  if (value.trim() === '') return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}
