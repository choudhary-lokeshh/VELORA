'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { LiveEncounterDetail, LiveOperationsState } from '../api/contract';
import {
  AreaNav,
  Badge,
  EmptyState,
  ErrorState,
  Fact,
  Facts,
  Field,
  Metric,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Reference,
  Scroller,
  Select,
  Table,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi } from '../app/providers';
import { formatDateTime, humanState, shortId, totalOf } from './format';
import { useResource } from './resource';

/**
 * Live, as an operations screen.
 *
 * What is deliberately not here is the number every product of this shape puts
 * at the top: how many people are online. Nothing can know it truthfully — a
 * closed browser, a sleeping phone and a dropped tunnel are identical from the
 * server — and a made-up figure at the top would make every honest number below
 * it worth less. What is published instead is what the platform wrote down:
 * participations by state, encounters it believes are running, and the age of
 * the oldest search still waiting, which is how a stalled matcher actually
 * shows up.
 *
 * And there is no way from this screen to a stream, a track, or a message.
 * Watching a call is not a feature this product has, and this is one of the
 * places it deliberately does not.
 */

const windowOptions = [
  { label: 'Last hour', value: '1' },
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
] as const;

export function PlatformLive() {
  const api = useApi();
  const pathname = usePathname();
  const [hours, setHours] = useState('24');
  const load = useCallback(async () => api.liveState({ hours }), [api, hours]);
  const state = useResource<LiveOperationsState>(load);

  return (
    <>
      <PageHeader
        lede="The matching pool in operational terms. Every figure is a count the platform wrote down; there is no “users online” here because nothing can know it."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="live-areas"
      />

      {state.error !== undefined && state.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={state.error}
              onRetry={state.retryable ? state.reload : undefined}
              testId="live-failed"
            />
          </PanelBody>
        </Panel>
      ) : state.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          {state.value.searchAdmitted ? null : (
            <Notice testId="live-paused" tone="critical">
              New live searches are paused. Encounters already running are
              continuing; nobody new is being admitted. The switch is on
              Platform · Controls.
            </Notice>
          )}

          <div className="a-toolbar">
            <Field label="Window">
              {(control) => (
                <Select
                  {...control}
                  data-testid="live-window"
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

          <div className="a-grid a-grid--narrow">
            <Panel testId="live-encounters">
              <PanelHead title="Encounters running" />
              <PanelBody>
                <Metric
                  caption="rows LIVE has not recorded an end for"
                  testId="live-encounters-count"
                  value={state.value.liveEncounters}
                />
              </PanelBody>
            </Panel>
            <Panel testId="live-starts">
              <PanelHead title="Encounters started" />
              <PanelBody>
                <Metric
                  caption={`since ${formatDateTime(state.value.since)}`}
                  testId="live-starts-count"
                  value={totalOf(
                    state.value.encounterStarts.map((row) => ({
                      count: row.total,
                    })),
                  )}
                />
              </PanelBody>
            </Panel>
            <Panel testId="live-oldest">
              <PanelHead title="Oldest search waiting" />
              <PanelBody>
                {state.value.oldestSearchSince === undefined ? (
                  <EmptyState
                    body="Nobody is searching. That is not an age of zero."
                    testId="live-oldest-empty"
                    title="No one waiting"
                  />
                ) : (
                  <p className="a-numeric a-subheading">
                    {formatDateTime(state.value.oldestSearchSince)}
                  </p>
                )}
              </PanelBody>
            </Panel>
          </div>

          <Panel testId="live-participations">
            <PanelHead title="Participations by state" />
            {state.value.participations.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="Nobody has entered the pool."
                  testId="live-participations-empty"
                  title="Nothing in any state"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Participations">
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
                      {state.value.participations.map((row) => (
                        <tr
                          data-testid={`live-participation-${row.label}`}
                          key={row.label}
                        >
                          <th scope="row">{humanState(row.label)}</th>
                          <td className="a-table__right a-numeric">
                            {row.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>

          <Panel testId="live-end-reasons">
            <PanelHead title="How encounters ended" />
            {state.value.endReasons.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="No encounter ended in this window."
                  testId="live-end-reasons-empty"
                  title="Nothing ended"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="End reasons">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Reason</th>
                        <th className="a-table__right" scope="col">
                          Count
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.value.endReasons.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{humanState(row.label)}</th>
                          <td className="a-table__right a-numeric">
                            {row.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>

          <Panel testId="live-premium">
            <PanelHead title="Paid narrowings open" />
            {state.value.premiumWindows.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="Nobody currently holds a paid live preference."
                  testId="live-premium-empty"
                  title="None open"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Paid narrowings">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Narrowed on</th>
                        <th className="a-table__right" scope="col">
                          Count
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.value.premiumWindows.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{humanState(row.label)}</th>
                          <td className="a-table__right a-numeric">
                            {row.total}
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

/**
 * One encounter, in operational facts.
 *
 * Two opaque identifiers, two instants, a reason it stopped, and whether
 * anything followed from it: did either person ask to keep talking, did either
 * report or block the other, was a paid narrowing involved. Those are the
 * questions an operator holding an encounter identifier actually has, and each
 * of them is answered without opening anybody's conversation.
 */
export function LiveEncounterScreen({
  encounterId,
}: {
  readonly encounterId: string;
}) {
  const api = useApi();
  const load = useCallback(
    async () => api.liveEncounter(encounterId),
    [api, encounterId],
  );
  const detail = useResource<LiveEncounterDetail>(load);

  if (detail.missing) {
    return (
      <Panel>
        <PanelBody>
          <EmptyState
            body="No encounter matches that identifier."
            testId="encounter-missing"
            title="Not found"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (detail.error !== undefined && detail.value === undefined) {
    return (
      <Panel>
        <PanelBody>
          <ErrorState
            body={detail.error}
            onRetry={detail.retryable ? detail.reload : undefined}
            testId="encounter-failed"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (detail.value === undefined) return <PanelSkeleton />;

  const encounter = detail.value;
  return (
    <>
      <PageHeader
        lede="State and health, never people. There is no video, audio, transcript, or chat on this screen and no route to one."
        title="Encounter"
      />
      <Panel testId="encounter-detail">
        <PanelHead
          actions={<Badge tone="neutral">{humanState(encounter.state)}</Badge>}
          title={shortId(encounter.id)}
        />
        <PanelBody>
          <Facts>
            <Fact term="Medium" value={humanState(encounter.medium)} />
            <Fact term="Started" value={formatDateTime(encounter.createdAt)} />
            <Fact
              term="Ended"
              value={
                encounter.endedAt === undefined
                  ? 'Still running'
                  : formatDateTime(encounter.endedAt)
              }
            />
            <Fact
              term="End reason"
              value={
                encounter.endReason === undefined
                  ? '—'
                  : humanState(encounter.endReason)
              }
            />
            <Fact
              term="RTC session"
              value={
                encounter.realtimeSessionId === undefined ? (
                  'None opened'
                ) : (
                  <Reference
                    short={shortId(encounter.realtimeSessionId)}
                    value={encounter.realtimeSessionId}
                  />
                )
              }
            />
            <Fact term="Paid narrowings" value={encounter.premiumWindows} />
            <Fact
              term="Reports between the pair"
              value={encounter.safety.reports}
            />
            <Fact
              term="Blocks between the pair"
              value={encounter.safety.blocks}
            />
            <Fact
              term="Connect"
              value={
                encounter.introduction === undefined
                  ? 'Neither asked'
                  : humanState(encounter.introduction.state)
              }
            />
          </Facts>
        </PanelBody>
      </Panel>

      <Panel testId="encounter-participants">
        <PanelHead title="Participants" />
        <PanelBody flush>
          <Scroller label="Participants">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                </tr>
              </thead>
              <tbody>
                {encounter.participants.map((participant) => (
                  <tr
                    data-testid={`encounter-participant-${participant}`}
                    key={participant}
                  >
                    <th scope="row">
                      <Link href={`/accounts/${participant}`}>
                        {shortId(participant)}
                      </Link>
                    </th>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      </Panel>
    </>
  );
}
