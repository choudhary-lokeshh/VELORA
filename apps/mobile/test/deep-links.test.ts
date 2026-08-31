import { linkSegments, resolveDeepLink } from '../src/frame/deep-links';
import { youSections } from '../src/frame/links';
import {
  resolvePushDestination,
  routablePushTemplateKeys,
} from '../src/push/routing';
import { notificationChannels } from '../src/push/channels';

/**
 * The two untrusted inputs that can put somebody on a screen without them
 * navigating there: a link another application fired, and a notification
 * payload a server composed.
 *
 * Neither is an authorization boundary and neither is treated as one. What is
 * asserted here is that a hostile or merely wrong input produces an address
 * this application publishes or no address at all — never a path assembled
 * from what arrived.
 */

const conversationId = '33333333-3333-4333-8333-333333333333';
const personId = '44444444-4444-4444-8444-444444444444';

describe('a deep link', () => {
  it('accepts every address the application publishes', () => {
    expect(resolveDeepLink('velora://discover')).toEqual({
      kind: 'route',
      path: '/discover',
    });
    expect(resolveDeepLink('velora://introductions')).toEqual({
      kind: 'route',
      path: '/introductions',
    });
    expect(resolveDeepLink('velora://messages')).toEqual({
      kind: 'route',
      path: '/messages',
    });
    expect(resolveDeepLink('velora://notices')).toEqual({
      kind: 'route',
      path: '/notices',
    });
    expect(resolveDeepLink('velora://you')).toEqual({
      kind: 'route',
      path: '/you',
    });
    // Every section, walked from the list the router reads, rather than one
    // named by hand. The hand-named version of this stayed green while
    // `velora://you/memberships` was refused: a test that lists a sample of
    // what it is checking can only ever prove the sample.
    for (const section of youSections) {
      expect(resolveDeepLink(`velora://you/${section}`)).toEqual({
        kind: 'route',
        path: `/you/${section}`,
      });
    }
    expect(resolveDeepLink(`velora://messages/${conversationId}`)).toEqual({
      kind: 'route',
      path: `/messages/${conversationId}`,
    });
    expect(resolveDeepLink(`velora://people/${personId}`)).toEqual({
      kind: 'route',
      path: `/people/${personId}`,
    });
    // The one address somebody is expected to send. Both screens have existed
    // and been reachable by tapping since the surface was built, and this
    // parser refused them — so a creator's own link landed on Notices under a
    // sentence saying it led nowhere, on the surface most likely to be handed
    // the link in the first place.
    expect(resolveDeepLink('velora://c/ember_vale')).toEqual({
      kind: 'route',
      path: '/c/ember_vale',
    });
    expect(resolveDeepLink('velora://c/ember_vale/club/inner-circle')).toEqual({
      kind: 'route',
      path: '/c/ember_vale/club/inner-circle',
    });
  });

  /**
   * A handle written the way a person writes it.
   *
   * The server folds case, so `@Ember_Vale` and `@ember_vale` are one creator
   * and Consumer Web serves both. A phone that refused the capitalised form
   * would make a link work on one surface and fail on the other, which is
   * indistinguishable from a broken link to whoever was sent it.
   */
  it('accepts a handle and a slug in the case they were written', () => {
    expect(resolveDeepLink('velora://c/Ember_Vale')).toEqual({
      kind: 'route',
      path: '/c/Ember_Vale',
    });
    expect(resolveDeepLink('velora://c/Ember_Vale/club/Inner-Circle')).toEqual({
      kind: 'route',
      path: '/c/Ember_Vale/club/Inner-Circle',
    });
  });

  /**
   * The creator route is the only one deeper than two segments, so it is the
   * only one that can be walked past its own leaves.
   */
  it('refuses a creator address that is not one of the two it serves', () => {
    for (const url of [
      // No creator listing exists, so a bare `c` leads nowhere.
      'velora://c',
      // `/c/<handle>/club` is not an address this application serves.
      'velora://c/ember_vale/club',
      // The `club` segment is required rather than assumed, so a third
      // segment naming something else is not read as a slug.
      'velora://c/ember_vale/posts/1',
      // Nothing lives below a club.
      'velora://c/ember_vale/club/inner/extra',
      // Outside the repertoire a handle or a slug can hold.
      'velora://c/-ember-',
      'velora://c/ember_vale/club/-inner-',
      'velora://c/em',
    ]) {
      const resolved = resolveDeepLink(url);
      expect(resolved.kind).toBe('refused');
      if (resolved.kind === 'refused') expect(resolved.path).toBe('/notices');
    }
  });

  it('reads the three spellings the platform actually produces', () => {
    // A notification intent, `Linking.createURL`, and somebody typing one.
    for (const url of [
      'velora://messages',
      'velora:///messages',
      'velora:/messages',
    ]) {
      expect(resolveDeepLink(url)).toEqual({
        kind: 'route',
        path: '/messages',
      });
    }
  });

  it('sends a launch with no path to Live', () => {
    // Live, not Discover. A bare `velora://` is somebody opening the product
    // rather than following a link to a particular thing, and since ADR-0040
    // the reason to open it is to meet somebody.
    expect(resolveDeepLink('velora://')).toEqual({
      kind: 'route',
      path: '/live',
    });
  });

  it('serves the Live destination by name', () => {
    expect(resolveDeepLink('velora://live')).toEqual({
      kind: 'route',
      path: '/live',
    });
    // The tab has nothing beneath it, so a deeper address is refused rather
    // than quietly truncated to the tab — which would be a different address
    // than the one somebody was given.
    // A refusal navigates: it lands on Notices and says why, rather than
    // leaving somebody on a screen that never changed.
    expect(resolveDeepLink('velora://live/anything')).toEqual({
      kind: 'refused',
      path: '/notices',
      reason: 'That link does not lead anywhere here.',
    });
  });

  it('refuses another application’s scheme', () => {
    for (const url of [
      'https://velora.example/messages',
      'exp+velora://messages',
      'javascript:alert(1)',
      'file:///etc/passwd',
      '',
    ]) {
      expect(resolveDeepLink(url).kind).toBe('refused');
    }
  });

  it('refuses an identifier that is not one', () => {
    for (const suffix of [
      'not-a-uuid',
      '../../you/account',
      '33333333-3333-4333-8333-33333333333',
      '%2e%2e%2fyou',
    ]) {
      const resolved = resolveDeepLink(`velora://messages/${suffix}`);
      expect(resolved.kind).toBe('refused');
      expect(resolveDeepLink(`velora://people/${suffix}`).kind).toBe('refused');
    }
    // There is no listing of people, so the bare address leads nowhere and is
    // refused rather than quietly sent somewhere it was not addressed to.
    expect(resolveDeepLink('velora://people').kind).toBe('refused');
  });

  it('never assembles a path out of what arrived', () => {
    // Every accepted address comes from the same builders the screens use, so
    // there is nothing to escape. These would each be a traversal if the
    // segments were concatenated instead of matched.
    for (const url of [
      'velora://you/../../discover',
      'velora://messages/%2f%2fevil',
      'velora://you/account/extra',
      'velora://unknown-area',
    ]) {
      const resolved = resolveDeepLink(url);
      expect(resolved.kind).toBe('refused');
      // A refusal still lands somewhere real rather than on a dead end.
      if (resolved.kind === 'refused') expect(resolved.path).toBe('/notices');
    }
  });

  it('ignores the development client’s address rather than refusing it', () => {
    // `velora://expo-development-client/?url=...` is how every development
    // build is pointed at a bundler, so the product sees it on every launch.
    // Refusing it announced a problem nobody caused and navigated away from
    // the address the launch was for — and, through the toast it raised, span
    // the application in an infinite remount loop on a real device.
    const resolved = resolveDeepLink(
      'velora://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081',
    );
    expect(resolved.kind).toBe('ignored');
    if (resolved.kind === 'ignored') {
      expect(resolved.owner).toBe('the development client');
    }
  });

  it('drops a query and a fragment rather than reading them', () => {
    expect(resolveDeepLink('velora://discover?next=/you/account#x')).toEqual({
      kind: 'route',
      path: '/discover',
    });
  });

  it('rejects an encoded separator instead of decoding it', () => {
    expect(linkSegments('velora://messages/a%2fb')).toBeUndefined();
  });
});

describe('a notification payload', () => {
  it('lands each approved template where the product keeps that thing', () => {
    expect(
      resolvePushDestination({
        conversationId,
        templateKey: 'messaging.message.received.v1',
      }),
    ).toEqual({ path: `/messages/${conversationId}`, recognized: true });

    expect(
      resolvePushDestination({
        introductionId: conversationId,
        templateKey: 'discovery.introduction.mutual.v1',
      }),
    ).toEqual({ path: '/introductions', recognized: true });
  });

  it('does not try to revive a call', () => {
    // The surface holds no call state and a cold start restores nothing, so a
    // notice tapped hours later opens the relationship rather than a call that
    // stopped ringing long ago.
    expect(
      resolvePushDestination({
        callId: conversationId,
        templateKey: 'realtime.call.incoming.v1',
      }),
    ).toEqual({ path: '/introductions', recognized: true });

    expect(
      resolvePushDestination({
        callId: conversationId,
        templateKey: 'realtime.call.missed.v1',
      }),
    ).toEqual({ path: '/notices', recognized: true });
  });

  it('lands safely on anything it does not understand', () => {
    for (const payload of [
      undefined,
      null,
      'string',
      {},
      { templateKey: 42 },
      { templateKey: 'messaging.message.received.v2' },
      // A known template with a missing or malformed identifier.
      { templateKey: 'messaging.message.received.v1' },
      { conversationId: 'nope', templateKey: 'messaging.message.received.v1' },
    ]) {
      const destination = resolvePushDestination(payload);
      expect(destination.recognized).toBe(false);
      expect(destination.path).toBe('/notices');
    }
  });

  it('knows exactly the four templates the platform approves', () => {
    // The catalogue in apps/api/src/notifications/policy.ts. A template added
    // there with no address here would land on Notices silently, so the count
    // is asserted rather than assumed.
    expect(routablePushTemplateKeys).toEqual([
      'discovery.introduction.mutual.v1',
      'messaging.message.received.v1',
      'realtime.call.incoming.v1',
      'realtime.call.missed.v1',
    ]);
  });
});

describe('the notification channels', () => {
  it('declares one per category that has an approved template, and no more', () => {
    // A channel appears in Android's settings whether or not anything is ever
    // sent through it, so one for a category with no template would be an
    // operating-system switch for a notification that does not exist.
    expect(
      notificationChannels.map((channel) => channel.category).sort(),
    ).toEqual(['call', 'direct_message', 'introduction']);
  });

  it('carries a versioned identifier, because none of it can be changed later', () => {
    for (const channel of notificationChannels) {
      expect(channel.id).toMatch(/^velora\.[a-z]+\.v\d+$/u);
      expect(channel.name.length).toBeGreaterThan(0);
      expect(channel.vibrationPattern.length).toBeGreaterThan(0);
    }
    expect(new Set(notificationChannels.map((c) => c.id)).size).toBe(
      notificationChannels.length,
    );
  });
});
