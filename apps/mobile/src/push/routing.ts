import {
  conversationPath,
  introductionsPath,
  noticesPath,
} from '../frame/links';

/**
 * Where tapping a notification takes somebody.
 *
 * The payload this reads is the one the platform already composes.
 * `apps/api/src/notifications/policy.ts` says of every approved template that
 * "the payload each carries is a deep-link target and nothing else. No body,
 * no sender name, no message preview" — and `intake.ts` builds exactly one
 * identifier per template. So this reads a template key and one identifier,
 * and there is nothing else in a notice to read.
 *
 * That minimalism is the whole design. Everything a screen shows is fetched
 * from the API after arriving, re-authorized by the server at that moment. A
 * notification that carried content would be content rendered without a
 * current authorization check, on a device that may have been offline for a
 * day, about a person who may since have blocked the reader.
 *
 * **A call notice does not open a call.** `docs/surfaces/02-consumer-mobile.md`
 * is explicit that a cold start restores nothing and "a notification tapped
 * hours later cannot revive a finished call — reaching for the pair opens a
 * new one instead". So an incoming-call notice lands on Introductions, where
 * the relationship is and where a new call is placed, and a missed-call notice
 * lands on Notices, which is the record of what happened. Neither pretends the
 * call is still there.
 *
 * Anything unrecognized lands on Notices rather than failing. A payload from a
 * template this build does not know about is a newer server talking to an
 * older application, which is a normal condition and not an error.
 */

export type PushRoutingPayload = Readonly<Record<string, unknown>>;

export interface PushDestination {
  readonly path: string;
  /** False when the payload was not understood and Notices is the fallback. */
  readonly recognized: boolean;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function identifier(
  payload: PushRoutingPayload,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && uuidPattern.test(value)
    ? value
    : undefined;
}

/**
 * The approved template catalogue, as addresses.
 *
 * Keyed by the template key the server writes on the intent rather than by the
 * in-app `kind`, because the key is what a delivery actually carries and is
 * versioned — `messaging.message.received.v1` becoming `.v2` is a template
 * change this table should have to acknowledge rather than silently absorb.
 */
const destinations: Readonly<
  Record<string, (payload: PushRoutingPayload) => string | undefined>
> = {
  'discovery.introduction.mutual.v1': (payload) =>
    identifier(payload, 'introductionId') === undefined
      ? undefined
      : introductionsPath,
  'messaging.message.received.v1': (payload) => {
    const conversationId = identifier(payload, 'conversationId');
    return conversationId === undefined
      ? undefined
      : conversationPath(conversationId);
  },
  'realtime.call.incoming.v1': (payload) =>
    identifier(payload, 'callId') === undefined ? undefined : introductionsPath,
  'realtime.call.missed.v1': (payload) =>
    identifier(payload, 'callId') === undefined ? undefined : noticesPath,
};

export function resolvePushDestination(payload: unknown): PushDestination {
  if (typeof payload !== 'object' || payload === null) {
    return { path: noticesPath, recognized: false };
  }
  const fields = payload as PushRoutingPayload;
  const templateKey = fields.templateKey;
  if (typeof templateKey !== 'string') {
    return { path: noticesPath, recognized: false };
  }
  const resolve = destinations[templateKey];
  if (resolve === undefined) return { path: noticesPath, recognized: false };
  const path = resolve(fields);
  return path === undefined
    ? { path: noticesPath, recognized: false }
    : { path, recognized: true };
}

/** Every template key this build knows how to land. Asserted by the tests. */
export const routablePushTemplateKeys: readonly string[] =
  Object.keys(destinations).sort();
