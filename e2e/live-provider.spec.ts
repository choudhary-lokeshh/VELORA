import {
  cohortFor,
  consumerWebOrigin,
  realtimeCarriesMedia,
  realtimeMatchesRealPeopleOnly,
} from './auth-environment.js';
import {
  cookieSkipReason,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
} from './consumer.js';
import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

/**
 * Two real people, one real provider, real media in both directions.
 *
 * Every other assertion in this repository about live discovery is about the
 * platform: who may meet whom, what is authorized, what is charged, what is
 * said. This is the one that is about the *medium*, and it is the only proof
 * here that two strangers can actually see and hear each other.
 *
 * Nothing about it is simulated. Two distinct seeded accounts sign in to two
 * separate browser contexts with separate cookie jars, the real matcher pairs
 * them because they are the only two people waiting, REALTIME issues each of
 * them their own short-lived credential, and the surfaces connect to a real
 * media server and exchange encoded frames. The cameras are Chromium's
 * synthetic devices, which is a real capture pipeline with a generated subject
 * rather than a stub: the browser encodes, sends, receives, and decodes.
 *
 * It is skipped unless this run was given a provider. That is deliberate rather
 * than convenient — CI has no media server, and a suite that quietly passed
 * without one would be the exact false evidence the `local-test` adapter is
 * named to prevent.
 *
 * Skipping it is also not a statement that the provider is approved.
 * Configuration refuses `livekit` in staging and production on its own, for a
 * reason recorded in the RTC provider eligibility register, and a green run
 * here changes none of that.
 */

async function allowCapture(
  context: BrowserContext,
  browserName: string,
): Promise<void> {
  if (browserName !== 'chromium') return;
  await context.grantPermissions(['camera', 'microphone'], {
    origin: consumerWebOrigin,
  });
}

/**
 * Whether the element is actually painting frames somebody could see.
 *
 * `videoWidth` is zero until the decoder has produced a frame, so it is the one
 * property that separates "an element exists with a track attached" from "this
 * person is on the screen". `currentTime` advancing is the same statement about
 * time rather than about a single frame, and both are asserted because a frozen
 * first frame would satisfy one of them alone.
 */
async function receivingVideo(page: Page): Promise<{
  readonly currentTime: number;
  readonly height: number;
  readonly width: number;
}> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLVideoElement>(
      '[data-testid="live-peer-video"]',
    );
    if (element === null) return { currentTime: 0, height: 0, width: 0 };
    return {
      currentTime: element.currentTime,
      height: element.videoHeight,
      width: element.videoWidth,
    };
  });
}

/** What the provider says is arriving, from the browser's own statistics. */
async function inboundTracks(page: Page): Promise<{
  readonly audioBytes: number;
  readonly videoBytes: number;
}> {
  return page.evaluate(async () => {
    const summary = { audioBytes: 0, videoBytes: 0 };
    // The transport's own statistics, which is the only place a byte count
    // exists. A count above zero is the provider having delivered encoded
    // media, rather than having negotiated a session that carries nothing.
    const connections = (
      globalThis as unknown as {
        __veloraPeerConnections?: RTCPeerConnection[];
      }
    ).__veloraPeerConnections;
    if (connections === undefined) return summary;
    for (const connection of connections) {
      const stats = await connection.getStats();
      // `RTCStatsReport` is a map-like whose value type the DOM library leaves
      // as `any`, so it is walked through `forEach` and each entry is narrowed
      // to the three fields this assertion reads.
      const entries: {
        bytesReceived?: number;
        kind?: string;
        type?: string;
      }[] = [];
      stats.forEach((value: unknown) => {
        entries.push(
          value as { bytesReceived?: number; kind?: string; type?: string },
        );
      });
      for (const entry of entries) {
        if (entry.type !== 'inbound-rtp') continue;
        if (entry.kind === 'video') {
          summary.videoBytes += entry.bytesReceived ?? 0;
        }
        if (entry.kind === 'audio') {
          summary.audioBytes += entry.bytesReceived ?? 0;
        }
      }
    }
    return summary;
  });
}

test.describe('Live discovery over a real provider', () => {
  test.skip(
    () => !realtimeCarriesMedia,
    'No RTC provider is configured for this run. Export REALTIME_LIVEKIT_URL, REALTIME_LIVEKIT_API_KEY, and REALTIME_LIVEKIT_API_SECRET to prove real media.',
  );
  test.skip(
    () => !realtimeMatchesRealPeopleOnly,
    'The deterministic stand-in is available, so a match could be a seeded account with no camera. Export LIVE_DISCOVERY_SIMULATION=unavailable so the only possible match is the other browser.',
  );
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  /*
   * Longer than any other test here, because it is the only one waiting on a
   * network negotiation and a video decoder rather than on this repository's
   * own code. Two peer connections have to be established, tracks published,
   * subscribed, and decoded on both sides — and a machine under load takes
   * seconds over it. Stated once for the whole file rather than raised
   * assertion by assertion, which would only move the failure.
   */
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('puts two real people into one room and carries them both ways', async ({
    browser,
  }, testInfo) => {
    const cohort = cohortFor(testInfo.project.name);
    const [first, second] = cohort.people;
    if (first === undefined || second === undefined) {
      throw new Error('the cohort needs two people for a two-person proof');
    }

    // Two contexts, two cookie jars, two accounts. One browser with two tabs
    // would share a session and would be one person opening two windows, which
    // proves nothing about two people meeting.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      await allowCapture(contextA, testInfo.project.name);
      await allowCapture(contextB, testInfo.project.name);
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Records every peer connection the page opens, before any script that
      // creates one runs. There is no other way to reach the transport's own
      // statistics from outside the SDK, and the statistics are the difference
      // between "connected" and "media arrived".
      for (const page of [pageA, pageB]) {
        await page.addInitScript(() => {
          const opened: RTCPeerConnection[] = [];
          (
            globalThis as unknown as {
              __veloraPeerConnections?: RTCPeerConnection[];
            }
          ).__veloraPeerConnections = opened;
          const Original = globalThis.RTCPeerConnection;
          globalThis.RTCPeerConnection = new Proxy(Original, {
            construct(
              target,
              argumentsList: ConstructorParameters<typeof RTCPeerConnection>,
            ) {
              const connection = new target(...argumentsList);
              opened.push(connection);
              return connection;
            },
          });
        });
      }

      // Everything the browser complains about, in the run output. A media
      // negotiation that fails does so in the console — a refused socket, a
      // rejected certificate, a policy violation — and none of it reaches an
      // assertion. Without this the only symptom is an element that never
      // appears, which says nothing about why.
      for (const [name, page] of [
        ['A', pageA],
        ['B', pageB],
      ] as const) {
        page.on('console', (message) => {
          if (message.type() !== 'error' && message.type() !== 'warning')
            return;
          void testInfo.attach(`console-${name}`, {
            body: `${message.type()}: ${message.text()}`,
            contentType: 'text/plain',
          });
        });
        page.on('pageerror', (error) => {
          void testInfo.attach(`pageerror-${name}`, {
            body: error.message,
            contentType: 'text/plain',
          });
        });
      }

      await signInAdmitted(pageA, first.subject);
      await signInAdmitted(pageB, second.subject);

      // The first person waits; the second arrives and the matcher pairs them.
      // Nothing here names anybody: both press the same control, and the server
      // decides who they meet.
      await pageA.getByTestId('live-start-video').click();
      await expect(pageA.getByTestId('live-room')).toBeVisible({
        timeout: 30_000,
      });
      await pageB.getByTestId('live-start-video').click();
      await expect(pageB.getByTestId('live-room')).toBeVisible({
        timeout: 30_000,
      });

      // Both are with somebody, and both are told the truth about what is
      // carrying them. The "no approved provider" sentence must be gone: it is
      // the honest answer with `local-test` and would be a lie here.
      for (const page of [pageA, pageB]) {
        await expect(page.getByTestId('live-peer-name')).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.getByTestId('live-no-media')).toHaveCount(0);
        await expect(page.getByTestId('live-media-failed')).toHaveCount(0);
      }

      // Each of them is sending before either is expected to receive. A local
      // preview with no stream means the browser never opened a camera, and a
      // proof that skipped this would blame the provider for it.
      for (const page of [pageA, pageB]) {
        await expect
          .poll(
            async () =>
              page.evaluate(() => {
                const element = document.querySelector<HTMLVideoElement>(
                  '[data-testid="live-local"] video',
                );
                const stream = element?.srcObject as MediaStream | null;
                return stream?.getTracks().length ?? 0;
              }),
            { timeout: 30_000 },
          )
          .toBeGreaterThan(0);
      }

      // And each of them can see the other. A remote video element exists, it
      // has decoded a frame, and its clock is advancing.
      for (const page of [pageA, pageB]) {
        await expect(page.getByTestId('live-peer-video')).toBeVisible({
          timeout: 60_000,
        });
        await expect
          .poll(async () => (await receivingVideo(page)).width, {
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
        const first_ = await receivingVideo(page);
        await expect
          .poll(async () => (await receivingVideo(page)).currentTime, {
            timeout: 30_000,
          })
          .toBeGreaterThan(first_.currentTime);
      }

      // Bytes, in both directions, for both kinds. This is the assertion that
      // cannot be satisfied by a negotiated session that carries nothing.
      for (const page of [pageA, pageB]) {
        await expect
          .poll(async () => (await inboundTracks(page)).videoBytes, {
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await inboundTracks(page)).audioBytes, {
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
      }

      // Next is a clean break. The first person moves on, and the second is
      // told their encounter ended rather than being left on a picture that has
      // stopped — and the room they were in is gone from both.
      await pageA.getByTestId('live-next').click();
      await expect(pageB.getByTestId('live-peer-video')).toHaveCount(0, {
        timeout: 60_000,
      });

      await pageA.getByTestId('live-end').click();
      await expect(pageA.getByTestId('live-door')).toBeVisible({
        timeout: 30_000,
      });
      await pageB.getByTestId('live-end').click();
      await expect(pageB.getByTestId('live-door')).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
