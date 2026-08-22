import { createHash } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import type { NotificationChannelPort } from './channel.js';
import { maximumProviderEventBytes } from './policy.js';
import type { NotificationRepository } from './repository.js';

export type ProviderFeedbackOutcome =
  | { readonly kind: 'accepted' }
  /** No provider is approved, so nothing is entitled to call this. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected'; readonly reason: 'oversized' | 'unverified' };

/**
 * Where a provider's account of a delivery arrives, and stops being trusted.
 *
 * The same four rules REALTIME applies to its provider events, because they are
 * the same problem: an unauthenticated party asserting facts about work this
 * platform asked for.
 *
 * **Bytes authenticate before anything parses them.** A signature covers the
 * exact octets that arrived, so verification happens against those and never
 * against a re-serialized object — a body checked after a round trip through
 * JSON authenticates a different document than the one that was signed.
 * Nothing unverified reaches the parser, and an unverifiable request creates no
 * row at all.
 *
 * **The body is discarded.** What survives is a digest of the exact bytes and a
 * normalized type in this domain's vocabulary. A retained webhook body is where
 * an address, a device token, or a fragment of somebody's message arrives and
 * stays, and there is nothing a later investigation can ask that the digest and
 * the normalized fields cannot answer.
 *
 * **Duplication is free and expected.** Identity is the provider, its account,
 * its environment, and the provider's own event identifier together, so the
 * fiftieth delivery of one event costs one refused insert. Reordering and
 * permanent absence are expected too; absence is recovered by reconciliation
 * rather than assumed benign.
 *
 * **A verified event is an observation, never an instruction.** It may update
 * what this platform knows about a delivery. It may not create a notice, mark
 * delivered something that was never attempted, lift a suppression, or bring
 * back a retired device registration.
 */
export class NotificationProviderEventService {
  constructor(
    private readonly dependencies: {
      readonly channel: NotificationChannelPort;
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly repository: NotificationRepository;
    },
  ) {}

  async receive(input: {
    readonly correlationId: string;
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<ProviderFeedbackOutcome> {
    if (this.dependencies.channel.provider === 'unavailable') {
      return { kind: 'unavailable' };
    }
    // Before the parser and before the verifier: a byte limit is the one check
    // that must not depend on reading what it is limiting.
    if (input.rawBody.byteLength > maximumProviderEventBytes) {
      return { kind: 'rejected', reason: 'oversized' };
    }

    let verified;
    try {
      verified = await this.dependencies.channel.verifyFeedback({
        headers: input.headers,
        rawBody: input.rawBody,
      });
    } catch (error) {
      // Deliberately uniform. A bad signature, a mutated body, an unknown
      // event type, and an unparseable payload are one answer, because telling
      // them apart would tell a forger which part to fix next.
      this.dependencies.logger.warn(
        { correlationId: input.correlationId, error },
        'notification provider event failed verification',
      );
      return { kind: 'rejected', reason: 'unverified' };
    }

    const now = this.dependencies.now();
    await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.recordProviderEvent(executor, {
        feedbackType: verified.feedbackType,
        now,
        occurredAt: verified.occurredAt,
        // Of the exact bytes that authenticated. The body goes no further.
        payloadDigest: createHash('sha256').update(input.rawBody).digest('hex'),
        provider: this.dependencies.channel.provider,
        providerAccount: this.dependencies.channel.account,
        providerEnvironment: this.dependencies.channel.environment,
        providerEventId: verified.eventId,
        providerReference: verified.providerReference,
        tokenFingerprint: verified.tokenFingerprint,
      }),
    );

    // Accepted means recorded, not applied. Applying happens on a worker
    // against a lease, so a provider's retry budget is never spent waiting for
    // work this platform chose to do later.
    return { kind: 'accepted' };
  }
}
