import type { SafeLogger } from '@velora/observability/server';

import type { RtcCallMedium } from './policy.js';
import type {
  RtcProviderPort,
  RtcProviderSessionSnapshot,
} from './provider.js';
import type { RtcRepository, RtcSessionRow } from './repository.js';
import type { RtcService } from './service.js';

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
      /**
       * Supplied late by the composition root, because the service is built
       * from this orchestrator and cannot also be handed to it at construction.
       * Absent in a composition that only binds provider sessions.
       */
      service?: RtcService;
    },
  ) {}

  /**
   * Closes the one cycle in this domain: the service is built from this
   * orchestrator, and this observes on the service's behalf.
   *
   * A setter rather than a constructor argument for the same reason the live
   * simulator attaches to the service it drives — the alternative is two
   * objects that cannot both be constructed first.
   */
  attach(service: RtcService): void {
    this.dependencies.service = service;
  }

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

  /**
   * Learns whether media actually started, from the provider rather than from
   * either endpoint.
   *
   * A session reaches `connecting` when the platform has done everything it
   * can: both people are admitted, a room exists, and credentials have been
   * issued. Whether anything is flowing is a fact only the transport has, and
   * the two endpoints are the least trustworthy participants in the call — so
   * it is asked of the provider, which is what `markConnected` requires.
   *
   * Without this a session never leaves `connecting`, and the join timeout
   * closes every call after thirty seconds. That was invisible while no adapter
   * carried media — a simulated call has nothing to observe and no test runs
   * for thirty seconds — and it is the first thing a real one meets.
   *
   * Every provider call is made outside a transaction, and the transition it
   * produces is the same guarded one every other caller uses, so two workers
   * observing at once produce one transition.
   */
  async observeConnections(limit = 20): Promise<{
    readonly connected: number;
    readonly examined: number;
  }> {
    if (this.dependencies.provider.provider === 'unavailable') {
      return { connected: 0, examined: 0 };
    }
    // Nothing to observe from an adapter that carries no packet. It would
    // answer faithfully and its answer would mean nothing about media.
    if (!this.dependencies.provider.capabilities.carriesMedia) {
      return { connected: 0, examined: 0 };
    }
    const waiting = await this.dependencies.repository.findAwaitingConnection(
      this.dependencies.repository.transactionless,
      { limit },
    );
    let connected = 0;
    for (const session of waiting) {
      const reference = session.providerReference;
      if (reference === null) continue;
      let snapshot: RtcProviderSessionSnapshot;
      try {
        snapshot =
          await this.dependencies.provider.retrieveCurrentState(reference);
      } catch (error) {
        // A provider that will not answer is not evidence about the call. The
        // session stays `connecting` and the join timeout still applies, which
        // is the fail-closed direction.
        this.dependencies.logger.warn(
          { error, sessionId: session.id },
          'rtc provider state could not be read',
        );
        continue;
      }
      // Only `live` moves anything. `pending` is a room nobody has joined,
      // `unknown` is a room the provider has already collected, and neither is
      // a statement that media started.
      if (snapshot.state !== 'live') continue;
      if (
        (await this.dependencies.service?.markConnected(session.id)) === true
      ) {
        connected += 1;
      }
    }
    return { connected, examined: waiting.length };
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
