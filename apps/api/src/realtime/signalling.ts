import type { SafeLogger } from '@velora/observability/server';

import type { RtcSessionState } from './policy.js';

/**
 * What a connected client is told, and the whole of it.
 *
 * A hint, not a fact. It says that a call moved and carries enough to know
 * which call and roughly what happened; it is never the reason a client
 * believes anything. The authoritative answer is `GET /v1/rtc/calls`, and a
 * client that missed one of these is expected to ask rather than to be
 * out of date — which is what makes losing one of these harmless.
 *
 * Deliberately minimal, on the same rule as the notification payloads: no
 * medium, no display name, no provider reference, no credential, no end reason,
 * no SDP, and no address. A fanout message travels over infrastructure this
 * domain does not control and lands in memory this domain cannot audit.
 */
export interface RtcSignal {
  readonly callId: string;
  /** The session's authorization generation at the moment it moved. */
  readonly generation: number;
  /** Who should care. One entry per participant, and never anybody else. */
  readonly recipientIds: readonly string[];
  readonly state: RtcSessionState;
}

/**
 * The fanout seam.
 *
 * REALTIME publishes; something else carries. The port exists so the carrying
 * can be Redis pub/sub, a future gateway process, or nothing at all, without
 * this domain learning which — and so that "nothing at all" is a first-class
 * answer rather than a broken dependency.
 *
 * Publishing is best-effort by construction and every caller treats it that
 * way. A call's state is committed to PostgreSQL before anything is published,
 * so a fanout that drops a message costs a client one refresh and never costs
 * the platform a call. [ADR-0008](../../../../docs/decisions/ADR-0008-realtime-rtc.md)
 * is explicit that realtime delivery is a hint and REST resync is the
 * correction; this is the publishing half of that.
 */
export interface RtcSignalPublisherPort {
  /** Never throws. A transport failure is logged and swallowed. */
  publish(signal: RtcSignal): Promise<void>;
  readonly transport: string;
}

/**
 * Carries nothing, and says so.
 *
 * The default in every environment. No realtime gateway is built — the consumer
 * surfaces that would connect to one are deferred — so there is nothing to
 * deliver to, and a publisher that pretended otherwise would be inventing an
 * audience. Clients read authoritative state over HTTP either way, which is
 * why this is a complete answer rather than a stub.
 */
export class UnavailableRtcSignalPublisher implements RtcSignalPublisherPort {
  readonly transport = 'unavailable';

  publish(): Promise<void> {
    return Promise.resolve();
  }
}

/** The narrow slice of a Redis client this needs. Keeps ioredis out of tests. */
export interface RtcSignalChannel {
  publish(channel: string, message: string): Promise<unknown>;
}

/**
 * Cross-instance fanout over ephemeral Redis.
 *
 * One channel per participant rather than per call, because the question a
 * gateway asks is "what should this connected person be told", and a
 * per-call channel would require every instance to know which calls each of
 * its connections cares about before it could subscribe.
 *
 * Redis is transport here and nothing else. It holds no call state, decides
 * nothing, and is never consulted to answer a question — losing the whole
 * instance loses zero durable facts, which is exactly the property
 * `docs/architecture/03-domain-boundaries.md` requires of it.
 */
export class RedisRtcSignalPublisher implements RtcSignalPublisherPort {
  readonly transport = 'redis';

  constructor(
    private readonly dependencies: {
      readonly channel: RtcSignalChannel;
      readonly logger: SafeLogger;
    },
  ) {}

  async publish(signal: RtcSignal): Promise<void> {
    const message = JSON.stringify({
      callId: signal.callId,
      generation: signal.generation,
      state: signal.state,
    });
    for (const recipientId of signal.recipientIds) {
      try {
        await this.dependencies.channel.publish(
          rtcSignalChannelFor(recipientId),
          message,
        );
      } catch (error) {
        // Swallowed on purpose. The call is already committed; a client that
        // never hears this asks for authoritative state and gets the same
        // answer a moment later. Failing the request here would turn a
        // cosmetic transport problem into a failed hang-up.
        this.dependencies.logger.warn(
          { callId: signal.callId, error },
          'rtc signal fanout failed; clients recover by reading state',
        );
      }
    }
  }
}

/**
 * The channel one person's connections subscribe to.
 *
 * Namespaced so a subscriber cannot receive another domain's messages by
 * accident, and keyed by account rather than by connection so a person with
 * several devices is reached on all of them without the publisher knowing how
 * many there are.
 */
export function rtcSignalChannelFor(recipientId: string): string {
  return `velora:rtc:participant:${recipientId}`;
}

/**
 * Reads a message back into the contract.
 *
 * A subscriber parses rather than casts, for the same reason an outbox consumer
 * does: the message was published by one version of this code and read by
 * another, and a shape that no longer matches has to be discarded rather than
 * surface as an undefined field in a client.
 */
export function parseRtcSignalMessage(
  message: string,
): { callId: string; generation: number; state: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.callId !== 'string' ||
    typeof candidate.state !== 'string' ||
    typeof candidate.generation !== 'number' ||
    !Number.isInteger(candidate.generation) ||
    candidate.generation < 1
  ) {
    return undefined;
  }
  return {
    callId: candidate.callId,
    generation: candidate.generation,
    state: candidate.state,
  };
}
