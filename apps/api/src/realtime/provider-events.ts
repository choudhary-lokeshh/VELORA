import { createHash } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import { maximumRtcProviderEventBytes } from './policy.js';
import type { RtcProviderPort } from './provider.js';
import type { RtcRepository } from './repository.js';

export type RtcProviderEventOutcome =
  | { readonly kind: 'accepted' }
  /** No provider is approved, so nothing is entitled to call this. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected'; readonly reason: 'oversized' | 'unverified' };

/**
 * Where a provider's account of a call arrives, and stops being trusted.
 *
 * Four rules, and every one of them is a thing that has gone wrong on other
 * platforms.
 *
 * **Bytes authenticate before anything parses them.** The signature covers the
 * exact octets that arrived, so verification happens against those and not
 * against a re-serialized object — a body checked after a round trip through
 * JSON authenticates a different document than the one that was sent. Nothing
 * unverified reaches the parser, and an unverifiable request creates no row at
 * all.
 *
 * **The body is discarded.** What survives is a digest of the exact bytes and a
 * normalized allow-list in this domain's vocabulary. A retained body is a place
 * where SDP, an address, or a credential arrives and stays, and there is no
 * question a later investigation can ask that the digest and the normalized
 * fields cannot answer.
 *
 * **Duplication is free and expected.** Identity is the provider, account,
 * environment, and the provider's own event identifier together, so the
 * fiftieth delivery of an event costs one refused insert. Reordering and
 * permanent absence are expected too: neither is an error, and absence is
 * recovered by reconciliation rather than assumed benign.
 *
 * **A verified event is an observation, never an instruction.** It may update
 * what the platform knows about a call's technical state. It may not create a
 * participant, grant permission, extend a credential, reverse a platform
 * decision, or resurrect a superseded generation — and a provider insisting a
 * room is alive after the platform ended the call is a divergence to reconcile
 * rather than a state to adopt.
 */
export class RtcProviderEventService {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly provider: RtcProviderPort;
      readonly repository: RtcRepository;
    },
  ) {}

  async receive(input: {
    readonly correlationId: string;
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<RtcProviderEventOutcome> {
    if (this.dependencies.provider.provider === 'unavailable') {
      return { kind: 'unavailable' };
    }
    // Before the parser, and before the verifier: a byte limit is the one check
    // that must not depend on reading what it is limiting.
    if (input.rawBody.byteLength > maximumRtcProviderEventBytes) {
      return { kind: 'rejected', reason: 'oversized' };
    }

    let verified;
    try {
      verified = await this.dependencies.provider.verifyEvent({
        headers: input.headers,
        rawBody: input.rawBody,
      });
    } catch (error) {
      // Deliberately uniform. A bad signature, a mutated body, a wrong account,
      // and an unparseable payload are one answer, because telling them apart
      // would tell an attacker which part of the forgery to fix.
      this.dependencies.logger.warn(
        { correlationId: input.correlationId, error },
        'rtc provider event failed verification',
      );
      return { kind: 'rejected', reason: 'unverified' };
    }

    const now = this.dependencies.now();
    await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.recordProviderEvent(executor, {
        normalizedEventType: verified.eventType,
        now,
        occurredAt: verified.occurredAt,
        // Of the exact bytes that authenticated. The body goes no further.
        payloadDigest: createHash('sha256').update(input.rawBody).digest('hex'),
        provider: this.dependencies.provider.provider,
        providerAccount: this.dependencies.provider.account,
        providerEnvironment: this.dependencies.provider.environment,
        providerEventId: verified.eventId,
        providerReference: verified.snapshot.providerReference,
      }),
    );

    // Accepted means recorded, not applied. Applying happens on a worker
    // thread against a lease, so a provider's retry budget is never spent
    // waiting for this platform to do work.
    return { kind: 'accepted' };
  }
}
