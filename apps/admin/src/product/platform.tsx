'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';

import type {
  IdentityState,
  MediaState,
  NotificationState,
  RtcState,
} from '../api/contract';
import {
  AreaNav,
  ErrorState,
  Metric,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Scroller,
  Table,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi } from '../app/providers';
import { Audit } from './audit';
import { OperatorActions } from './operator-audit';
import { Adapters, Availability, Backlogs, StateCounts } from './readouts';
import { humanState, identityPurposeLabels, plural, totalOf } from './format';
import { useResource } from './resource';

/**
 * Platform health: four subsystems, one shape.
 *
 * MEDIA, NOTIFICATIONS, REALTIME, and IDENTITY ASSURANCE each publish the same
 * three things — which adapters this process composed, how many things are in
 * each state, and what work is owed with the age of its oldest item. Rendering
 * them identically is the point: an operator asking "is anything stuck" should
 * ask the question once and read the answer the same way four times.
 *
 * None of the four screens identifies anybody. No owner, no account, no object
 * key, no digest, no asset identifier, no recipient, no participant, and no
 * subject. There is also **no list and no search on any of them**, and that is
 * the same rule rather than an omission: an operator who could page through
 * everybody's media, notices, or calls has a browsing surface over private
 * things however it is labelled.
 *
 * Two exact-reference reads exist in the contract and are deliberately not
 * here. A media asset and an RTC call can each be read by an identifier, and
 * putting a lookup field beside a dashboard is exactly where a search over
 * private material begins. The API offers those reads to a tool that already
 * holds an identifier; these screens offer neither.
 */

export function PlatformNav() {
  const pathname = usePathname();
  return (
    <AreaNav
      areas={platformAreas}
      current={pathname}
      label="Platform"
      testId="platform-nav"
    />
  );
}

/**
 * The shell every health screen shares: a header, the area navigation, and one
 * of loading, failed, or the readout.
 */
function Health<T>({
  children,
  lede,
  resource,
  testId,
}: {
  readonly children: (value: T) => React.ReactNode;
  readonly lede: string;
  readonly resource: {
    readonly error: string | undefined;
    readonly reload: () => void;
    readonly retryable: boolean;
    readonly value: T | undefined;
  };
  readonly testId: string;
}) {
  return (
    <>
      <PageHeader lede={lede} title="Platform" />
      <PlatformNav />
      {resource.error !== undefined && resource.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={resource.error}
              onRetry={resource.retryable ? resource.reload : undefined}
              testId={`${testId}-failed`}
            />
          </PanelBody>
        </Panel>
      ) : resource.value === undefined ? (
        <Panel testId={`${testId}-loading`}>
          <PanelBody>
            <PanelSkeleton rows={4} />
          </PanelBody>
        </Panel>
      ) : (
        children(resource.value)
      )}
    </>
  );
}

/* ================================ Media ============================== */

export function PlatformMedia() {
  const api = useApi();
  const load = useCallback(async () => api.mediaState(), [api]);
  const state = useResource<MediaState>(load);

  return (
    <Health
      lede="What the media platform is holding and what it owes. Nothing here names an owner, an object, or an asset."
      resource={state}
      testId="media"
    >
      {(value) => (
        <>
          <Availability
            available={value.liveMediaAvailable}
            availableTitle="This environment accepts media"
            testId="media-availability"
            unavailableTitle="This environment accepts no media"
          >
            {value.liveMediaAvailable
              ? 'Uploads are accepted, inspected, and processed here.'
              : 'No approved storage provider is composed, so nothing can be uploaded and nothing can be delivered. Counts below describe what already exists.'}
          </Availability>

          <Adapters rows={value.adapters} testId="media-adapters" />

          <StateCounts
            emptyBody="Nothing about media needs a person to look at it."
            emptyTitle="Nothing needs attention"
            rows={value.attention}
            testId="media-attention"
            title="Needs a person"
            what={['item', 'items']}
          />

          <Backlogs
            rows={value.backlogs}
            testId="media-backlogs"
            title="Owed work"
          />

          <div className="a-grid">
            <StateCounts
              rows={value.assets}
              testId="media-assets"
              title="Assets"
              what={['asset', 'assets']}
            />
            <StateCounts
              rows={value.objects}
              testId="media-objects"
              title="Stored objects"
              what={['object', 'objects']}
            />
            <StateCounts
              rows={value.obligations}
              testId="media-obligations"
              title="Obligations"
              what={['obligation', 'obligations']}
            />
            <StateCounts
              emptyBody="The platform and the storage provider agree about everything."
              emptyTitle="No disagreement"
              rows={value.drift}
              testId="media-drift"
              title="Disagreements with the provider"
              what={['finding', 'findings']}
            />
          </div>

          <Panel testId="media-no-lookup">
            <PanelHead title="There is no lookup here" />
            <PanelBody>
              <p className="a-small a-muted a-measure">
                One media operation exists — asking a delivery layer to forget
                an address — and it names a single asset. It is reached from a
                drift finding, a report, or a support conversation rather than
                by browsing, and a lookup field beside a dashboard is where a
                search over everybody's private images begins. The API offers
                the operation and the detail read to a tool that already holds
                an identifier; this screen offers neither.
              </p>
            </PanelBody>
          </Panel>
        </>
      )}
    </Health>
  );
}

/* ============================ Notifications ========================== */

export function PlatformNotifications() {
  const api = useApi();
  const load = useCallback(async () => api.notificationState(), [api]);
  const state = useResource<NotificationState>(load);

  return (
    <Health
      lede="What the platform has tried to deliver, and what it is still holding. No recipient and no address appears here."
      resource={state}
      testId="notifications"
    >
      {(value) => (
        <>
          <Adapters rows={value.adapters} testId="notifications-adapters" />

          <Backlogs
            rows={value.backlogs}
            testId="notifications-backlogs"
            title="Owed work"
          />

          <div className="a-grid">
            <StateCounts
              rows={value.intents}
              testId="notifications-intents"
              title="Intents"
              what={['intent', 'intents']}
            />
            <StateCounts
              rows={value.attempts}
              testId="notifications-attempts"
              title="Attempts"
              what={['attempt', 'attempts']}
            />
            <StateCounts
              emptyBody="No delivery has failed in a way the platform classified."
              emptyTitle="No failures"
              rows={value.failures}
              testId="notifications-failures"
              title="Failures"
              what={['failure', 'failures']}
            />
            <StateCounts
              rows={value.suppressions}
              testId="notifications-suppressions"
              title="Suppressions"
              what={['suppression', 'suppressions']}
            />
            <StateCounts
              rows={value.devices}
              testId="notifications-devices"
              title="Registered devices"
              what={['device', 'devices']}
            />
            <StateCounts
              rows={value.providerEvents}
              testId="notifications-provider-events"
              title="Provider events"
              what={['event', 'events']}
            />
          </div>

          <Panel testId="notifications-no-lookup">
            <PanelHead title="There is no notice lookup here" />
            <PanelBody>
              <p className="a-small a-muted a-measure">
                The platform publishes one exact-reference read of a single
                delivery, for a tool that already holds its identifier, and this
                screen deliberately offers no way to reach it. Every notice
                belongs to somebody, so a field beside a dashboard that accepted
                an identifier would be where a browsing surface over what the
                platform has sent people begins. What an operator can act on is
                here already: how much is undelivered, how old the oldest of it
                is, and which class of failure or suppression it fell into.
              </p>
            </PanelBody>
          </Panel>
        </>
      )}
    </Health>
  );
}

/* ================================= RTC =============================== */

export function PlatformRtc() {
  const api = useApi();
  const load = useCallback(async () => api.rtcState(), [api]);
  const state = useResource<RtcState>(load);

  return (
    <Health
      lede="Call lifecycle as REALTIME holds it. No participant, no conversation, and no media stream appears here."
      resource={state}
      testId="rtc"
    >
      {(value) => (
        <>
          <Availability
            available={value.liveCallingAvailable}
            availableTitle="This environment can carry a call"
            testId="rtc-availability"
            unavailableTitle="This environment carries no call audio or video"
          >
            {value.liveCallingAvailable
              ? 'An approved provider is composed and a call can be connected.'
              : 'No approved RTC provider is composed. The call lifecycle below is real; nothing is being carried between anybody.'}
          </Availability>

          <Adapters rows={value.adapters} testId="rtc-adapters" />

          <div className="a-grid a-grid--narrow">
            <Panel testId="rtc-undischarged">
              <PanelHead title="Ended without teardown" />
              <PanelBody>
                <Metric
                  caption="calls that ended while a teardown was still owed"
                  testId="rtc-undischarged-count"
                  {...(value.endedWithUndischargedTeardown > 0
                    ? { tone: 'caution' as const }
                    : {})}
                  value={value.endedWithUndischargedTeardown}
                />
              </PanelBody>
            </Panel>
            <Panel testId="rtc-calls-total">
              <PanelHead title="Calls held" />
              <PanelBody>
                <Metric
                  caption="across every lifecycle state"
                  testId="rtc-calls-count"
                  value={totalOf(value.calls)}
                />
              </PanelBody>
            </Panel>
          </div>

          <Backlogs
            rows={value.backlogs}
            testId="rtc-backlogs"
            title="Owed work"
          />

          <div className="a-grid">
            <StateCounts
              rows={value.calls}
              testId="rtc-calls"
              title="Calls"
              what={['call', 'calls']}
            />
            <StateCounts
              rows={value.providerObligations}
              testId="rtc-obligations"
              title="Provider obligations"
              what={['obligation', 'obligations']}
            />
            <StateCounts
              rows={value.providerEvents}
              testId="rtc-provider-events"
              title="Provider events"
              what={['event', 'events']}
            />
          </div>
        </>
      )}
    </Health>
  );
}

/* =============================== Identity ============================ */

export function PlatformIdentity() {
  const api = useApi();
  const load = useCallback(async () => api.identityState(), [api]);
  const state = useResource<IdentityState>(load);

  return (
    <Health
      lede="Verification health in aggregate. There is no identity search, export, or override anywhere in this product."
      resource={state}
      testId="identity"
    >
      {(value) => (
        <>
          <Adapters
            rows={{ provider: value.provider }}
            testId="identity-adapters"
            title="Composed verifier"
          />

          <Panel testId="identity-attempts">
            <PanelHead
              actions={
                <span className="a-caption a-quiet a-numeric">
                  {plural(totalOf(value.attempts), 'attempt', 'attempts')}
                </span>
              }
              lede="Counted by what the attempt was for and where it got to. No subject is named."
              title="Attempts"
            />
            {value.attempts.length === 0 ? (
              <PanelBody>
                <p className="a-small a-muted">
                  No verification has been attempted in this environment.
                </p>
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Verification attempts">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Purpose</th>
                        <th scope="col">State</th>
                        <th className="a-table__right" scope="col">
                          Count
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.attempts.map((attempt) => (
                        <tr key={`${attempt.purpose}:${attempt.state}`}>
                          <td>
                            {identityPurposeLabels[attempt.purpose] ??
                              humanState(attempt.purpose)}
                          </td>
                          <td>{humanState(attempt.state)}</td>
                          <td className="a-table__right a-numeric">
                            {attempt.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>

          <Backlogs
            rows={value.providerEventBacklog.map((row) => ({
              breached: false,
              count: row.count,
              ...(row.oldestAgeSeconds === undefined
                ? {}
                : { oldestAgeSeconds: row.oldestAgeSeconds }),
              state: row.state,
              // IDENTITY ASSURANCE publishes this backlog without a threshold
              // of its own, so none is invented: the column reports zero, which
              // reads as "no deadline published" beside a real one elsewhere.
              thresholdSeconds: 0,
            }))}
            testId="identity-event-backlog"
            title="Provider events owed"
          />

          <div className="a-grid">
            <StateCounts
              rows={value.providerEvents}
              testId="identity-provider-events"
              title="Provider events"
              what={['event', 'events']}
            />
            <StateCounts
              emptyBody="No evidence has expired."
              emptyTitle="Nothing expired"
              rows={value.expiredEvidence}
              testId="identity-expired"
              title="Expired evidence"
              what={['record', 'records']}
            />
            <StateCounts
              rows={value.outbox}
              testId="identity-outbox"
              title="Outbox"
              what={['fact', 'facts']}
            />
          </div>

          <Panel testId="identity-no-lookup">
            <PanelHead title="There is no subject lookup here" />
            <PanelBody>
              <p className="a-small a-muted a-measure">
                The platform publishes one exact-reference read of a
                verification subject, and it requires an action authorization no
                route issues. There is no identity search, list, export,
                mutation, manual grant, refusal, revocation, or override
                anywhere in this product, and this screen adds none.
              </p>
            </PanelBody>
          </Panel>
        </>
      )}
    </Health>
  );
}

/* =============================== Security ============================ */

/**
 * AUTH's own operational record, read as an area of Platform rather than as an
 * "Audit" destination of its own.
 *
 * Every other subsystem's operational record is read here, and this is one:
 * what the authentication layer has seen. Putting it beside Media,
 * Notifications, Calling, and Identity keeps the console organised by the
 * domain that owns each record rather than by how serious the word on the tab
 * sounds — and it is why the platform's settled moderation decisions sit under
 * Queues, with the work that produced them, instead of being pulled here to
 * make one bucket called audit.
 */
export function PlatformSecurity() {
  return (
    <>
      <PageHeader
        lede="What the platform recorded about authentication, and what operators did to the platform. Both records are append-only."
        title="Platform"
      />
      <PlatformNav />
      <Audit
        emptyBody="AUTH has recorded no event in this environment."
        emptyTitle="Nothing recorded"
        lede="An enumerated event type and an enumerated reason. There is no free-form payload in this record to leak into."
        stream="security"
        title="Authentication and session events"
      />
      {/*
        The operator's own record sits beside AUTH's rather than in a
        destination of its own, because the question they answer together is one
        question: what happened to this platform, and who did it. A separate
        "Audit" area would have meant an operator reading half a timeline.
      */}
      <OperatorActions />
    </>
  );
}
