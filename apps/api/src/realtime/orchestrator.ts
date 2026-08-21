import type { SafeLogger } from '@velora/observability/server';

import type { RtcCallMedium } from './policy.js';
import type {
  RtcProviderPort,
  RtcProviderSessionSnapshot,
} from './provider.js';
import type { RtcRepository, RtcSessionRow } from './repository.js';

export type ProviderBindingOutcome =
  | { readonly kind: 'bound'; readonly session: RtcSessionRow }
  /** No provider is approved, so no session can be carried. */
  | { readonly kind: 'unavailable' }
  /** The provider was asked and did not answer usably. Recoverable. */
  | { readonly kind: 'unresolved' };

/**
 * Everything that happens between a platform decision and a provider knowing
 * about it.
 *
 * The shape is forced by one rule and one fact. The rule is that no provider
 * call may run inside a database transaction: a pooled connection held across
 * somebody else's network is a connection [ADR-0019]'s admission bound cannot
 * account for, and a slow vendor would become a database outage. The fact is
 * that a network call has three outcomes rather than two — success, failure,
 * and *no answer* — and the third is the one that loses rooms.
 *
 * So creation is two transactions with a network call between them:
 *
 *   1. reserve — the session already exists and already carries the
 *      idempotency key the provider will be given, committed before anything
 *      external happens;
 *   2. call the provider, holding no connection;
 *   3. bind — record the provider's reference against the session.
 *
 * A crash at any boundary is recoverable, and recoverable in one direction:
 * the key was committed first, so an ambiguous create is resolved by asking
 * the provider what it did with that key rather than by creating a second
 * room. Nothing here ever infers success from a timeout.
 */
export class RtcProviderOrchestrator {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly provider: RtcProviderPort;
      readonly repository: RtcRepository;
    },
  ) {}

  /** Which adapter is in force. Configuration, never a request field. */
  get providerName(): string {
    return this.dependencies.provider.provider;
  }

  /**
   * Gives an accepted call somewhere to happen.
   *
   * Returns `unresolved` rather than throwing when the provider is ambiguous,
   * because an ambiguous create is a state to reconcile rather than an error to
   * surface: the platform's own record is intact either way, and the caller's
   * correct response is to leave the call connecting and let recovery finish
   * it.
   */
  async bindProviderSession(input: {
    readonly medium: RtcCallMedium;
    readonly providerIdempotencyKey: string;
    readonly sessionId: string;
  }): Promise<ProviderBindingOutcome> {
    if (this.dependencies.provider.provider === 'unavailable') {
      return { kind: 'unavailable' };
    }

    let snapshot: RtcProviderSessionSnapshot | undefined;
    try {
      // Outside every transaction, deliberately and verifiably: an integration
      // test asserts no transaction is open while this runs.
      snapshot = await this.dependencies.provider.createSession({
        correlationId: input.sessionId,
        medium: input.medium,
        platformSessionReference: input.sessionId,
        providerIdempotencyKey: input.providerIdempotencyKey,
      });
    } catch (error) {
      // The key was committed before the call, so this is answerable rather
      // than lost. Ask what the provider did with it.
      snapshot = await this.recoverByIdempotencyKey(
        input.providerIdempotencyKey,
        error,
      );
      if (snapshot === undefined) return { kind: 'unresolved' };
    }

    // A provider that echoes back a different session than the one it was
    // asked about is not answering about this call, and binding it would
    // attach one person's call to another's room.
    if (snapshot.platformSessionReference !== input.sessionId) {
      this.dependencies.logger.error(
        { sessionId: input.sessionId },
        'rtc provider answered about a different session',
      );
      return { kind: 'unresolved' };
    }

    const bound = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.bindProviderSession(executor, {
        now: this.dependencies.now(),
        providerReference: snapshot.providerReference,
        sessionId: input.sessionId,
      }),
    );
    return bound === undefined
      ? { kind: 'unresolved' }
      : { kind: 'bound', session: bound };
  }

  private async recoverByIdempotencyKey(
    providerIdempotencyKey: string,
    cause: unknown,
  ): Promise<RtcProviderSessionSnapshot | undefined> {
    if (!this.dependencies.provider.capabilities.stateRetrieval) {
      this.dependencies.logger.warn(
        { error: cause },
        'rtc provider create was ambiguous and the adapter cannot look it up',
      );
      return undefined;
    }
    try {
      return await this.dependencies.provider.retrieveByIdempotencyKey(
        providerIdempotencyKey,
      );
    } catch (error) {
      // Two failures in a row is not a reason to create a second room. The
      // reservation stands and reconciliation owns it from here.
      this.dependencies.logger.warn(
        { error },
        'rtc provider lookup after an ambiguous create also failed',
      );
      return undefined;
    }
  }

  /**
   * Tells the provider to stop carrying a call the platform has ended.
   *
   * Best effort by construction, and that is why ending does not depend on it:
   * the platform's terminal state and its generation advance are already
   * committed before this runs, so a provider that never hears is a divergence
   * for reconciliation rather than a call that stays open on the platform.
   */
  async terminateProviderSession(providerReference: string): Promise<boolean> {
    try {
      await this.dependencies.provider.endSession(providerReference);
      return true;
    } catch (error) {
      this.dependencies.logger.warn(
        { error },
        'rtc provider termination failed; the obligation stands',
      );
      return false;
    }
  }

  /** Removes one participant. Same best-effort rule as termination. */
  async revokeParticipant(input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }): Promise<boolean> {
    try {
      await this.dependencies.provider.revokeParticipant(input);
      return true;
    } catch (error) {
      this.dependencies.logger.warn(
        { error },
        'rtc participant revocation failed; the obligation stands',
      );
      return false;
    }
  }
}
