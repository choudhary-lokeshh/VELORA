import { cohortFor, consumerWebOrigin } from './auth-environment.js';
import {
  cookieSkipReason,
  navigateTo,
  signInAdmitted,
  skipWhenCookieRequiresHttps,
} from './consumer.js';
import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures.js';

/**
 * Random live discovery in a real browser.
 *
 * This is the only place the whole loop is real at once: a real camera
 * permission decision, a real `getUserMedia` against Chromium's fake device, a
 * real match allocated by the real matcher, a real live session opened through
 * REALTIME's own contract, real words exchanged, and a real introduction that
 * produces a real conversation in the Inbox. jsdom can prove what a component
 * renders; it cannot prove that a browser will hand over a camera, that the
 * preview element receives a stream, or that a page navigated away from
 * releases the device.
 *
 * The stand-in on the other side is a seeded local account driven through the
 * same published service methods a second browser would call, which is what
 * makes one browser enough to walk a two-person feature. Nothing about it is
 * fabricated: the account is real, onboarded, and eligible, and the matcher
 * applies every safety and standing predicate to it.
 */

/**
 * Puts this person at the door, whatever state the server has them in.
 *
 * Live is the one destination somebody can return to *mid-encounter*: the
 * server holds the encounter, and the surface deliberately puts them back into
 * the room rather than at the door, because that is where they actually are.
 * A test that assumed the door would therefore be asserting the absence of a
 * feature. Leaving first is what a person does, and it goes through the real
 * departure route.
 */
/**
 * Grants the capture permissions, where the browser has a name for them.
 *
 * Chromium's driver knows `camera` and `microphone`; Firefox's does not, and
 * `grantPermissions` throws `Unknown permission: camera` there. Firefox is
 * configured instead through `media.navigator.permission.disabled` and
 * `media.navigator.streams.fake` in `playwright.config.ts`, so the capture is
 * already permitted and there is nothing to grant.
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

async function atTheDoor(page: Page): Promise<void> {
  const door = page.getByTestId('live-door');
  if (await door.isVisible()) return;
  await page.getByTestId('live-end').click();
  await expect(door).toBeVisible({ timeout: 30_000 });
}

test.describe('Live discovery', () => {
  test.skip(
    ({ browserName }) => skipWhenCookieRequiresHttps(browserName),
    cookieSkipReason,
  );
  // Serial within a project: these share one cohort deliberately, because the
  // conversation one test creates is the conversation another reads.
  test.describe.configure({ mode: 'serial' });

  test('is where an admitted person lands, and opens no camera by arriving', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);

    // A door, not a viewfinder. This is the assertion the whole permission
    // model rests on: loading a page is not consent to be seen.
    await expect(page.getByTestId('live-door')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);

    // Both ways in are offered separately. Agreeing to be heard is not agreeing
    // to be seen.
    await expect(page.getByTestId('live-start-video')).toBeVisible();
    await expect(page.getByTestId('live-start-voice')).toBeVisible();

    // And nothing on it invents an audience.
    const rendered = await page.locator('body').innerText();
    for (const forbidden of ['online now', 'people waiting', 'viewers']) {
      expect(rendered.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  test('opens the camera on request, meets somebody, and talks to them', async ({
    context,
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    // Granted here rather than left to a prompt, because a browser automation
    // context has nobody to answer one. What is being proved is that the
    // surface asks at the right moment and does something real with the answer.
    await allowCapture(context, testInfo.project.name);
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);

    await page.getByTestId('live-start-video').click();

    // A real stream in a real element. `srcObject` is set imperatively, so this
    // is the assertion that the preview is bound to a device rather than merely
    // rendered.
    const preview = page.getByTestId('live-local-video');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          preview.evaluate(
            (element) => (element as HTMLVideoElement).srcObject !== null,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    // Somebody real on the other side, with a real name.
    await expect(page.getByTestId('live-peer-name')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('live-peer-name')).not.toBeEmpty();

    // And an honest account of what is carrying them, rather than a black
    // rectangle implying a connection that does not exist.
    await expect(page.getByTestId('live-no-media')).toContainText(
      'no approved provider exists yet',
    );

    // Words, both ways. The stand-in answers through the same send route.
    await page.getByTestId('live-chat-input').fill('hello from the browser');
    await page.getByTestId('live-chat-send').click();
    await expect(page.getByTestId('live-chat-list')).toContainText(
      'hello from the browser',
    );
    await page.getByTestId('live-sim-peer_message').click();
    await expect(page.getByTestId('live-chat-list')).toContainText(
      'local stand-in',
      { timeout: 30_000 },
    );

    // Mute is a real control over a real track.
    await page.getByTestId('live-toggle-mic').click();
    await expect(page.getByTestId('live-toggle-mic')).toHaveAttribute(
      'aria-label',
      'Unmute your microphone',
    );

    // Left cleanly, so the next test in this serial group starts from the door
    // rather than from whatever this one was in the middle of.
    await page.getByTestId('live-end').click();
    await expect(page.getByTestId('live-door')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('connects only when both people ask, and the conversation survives', async ({
    context,
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await allowCapture(context, testInfo.project.name);
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);
    await page.getByTestId('live-start-video').click();
    await expect(page.getByTestId('live-connect')).toBeVisible({
      timeout: 30_000,
    });

    /*
     * One tap is not a connection — unless the other person has already
     * tapped, which is the *same* rule seen from the other side and is a state
     * a persistent world genuinely produces: these two may have met before.
     *
     * So the standing before the tap decides what the tap may produce, and
     * both branches assert the rule rather than one of them assuming a fresh
     * pair. What neither branch permits is reaching `connected` from `none` in
     * one press.
     */
    const badge = page.getByTestId('live-connection');
    const before = await badge.textContent();

    if (before === 'Connect') {
      // A fresh pair. One tap is not a connection.
      await page.getByTestId('live-connect').click();
      await expect(badge).toHaveText('Waiting for them', { timeout: 30_000 });

      // The other person asks too, independently. Only now is it mutual.
      await page.getByTestId('live-sim-peer_connect').click();
      await expect(badge).toHaveText('You are connected', { timeout: 30_000 });
    } else if (before === 'They want to connect') {
      // The other person asked first, which is the same rule from the other
      // side: this person's single tap completes it and nothing before it did.
      await page.getByTestId('live-connect').click();
      await expect(badge).toHaveText('You are connected', { timeout: 30_000 });
    } else {
      // Already connected, which a persistent world genuinely produces: these
      // two have met before. There is nothing to press — the control is
      // disabled, which is itself the assertion that a connection is not
      // something this surface can re-make — and what still has to hold is
      // everything below about the conversation surviving.
      expect(before).toBe('You are connected');
      await expect(page.getByTestId('live-connect')).toBeDisabled();
    }

    // They move on. The relationship is what survives the encounter.
    await page.getByTestId('live-sim-peer_next').click();
    await expect(page.getByTestId('live-ended')).toContainText(
      'They moved on',
      {
        timeout: 30_000,
      },
    );
    const conversationLink = page.getByTestId('live-ended-conversation');
    await expect(conversationLink).toBeVisible();

    // And it is in the Inbox, as one conversation, ready to carry on in.
    await conversationLink.click();
    await page.waitForURL(/\/messages\/[0-9a-f-]+/u, { timeout: 30_000 });
    await expect(page.getByTestId('conversation-view')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('message-body')).toBeVisible();

    await navigateTo(page, 'messages');
    await expect(page.getByTestId('conversation-list')).toBeVisible();
  });

  test('releases the camera when the screen is left', async ({
    context,
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await allowCapture(context, testInfo.project.name);
    await signInAdmitted(page, person.subject);
    await atTheDoor(page);
    await page.getByTestId('live-start-video').click();
    await expect(page.getByTestId('live-local-video')).toBeVisible({
      timeout: 30_000,
    });

    // Ending closes the devices before the answer is even rendered, because
    // somebody pressing End is asking for the camera to stop.
    await page.getByTestId('live-end').click();
    await expect(page.getByTestId('live-door')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('video')).toHaveCount(0);

    // And navigating away leaves nothing bound either.
    await navigateTo(page, 'discover');
    await expect(page.locator('video')).toHaveCount(0);
  });

  test('keeps every other destination exactly where it was', async ({
    page,
  }, testInfo) => {
    const [person] = cohortFor(testInfo.project.name).people;
    if (person === undefined) throw new Error('the cohort has nobody in it');
    await signInAdmitted(page, person.subject);

    // Live is added to the navigation rather than replacing anything in it.
    for (const destination of [
      'discover',
      'introductions',
      'messages',
      'notifications',
      'you',
    ] as const) {
      await navigateTo(page, destination);
      await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty();
    }
    await navigateTo(page, 'live');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live');
  });
});
