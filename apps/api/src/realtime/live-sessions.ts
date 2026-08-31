import type { RtcCallMedium } from './policy.js';
import type { RtcProviderPort } from './provider.js';
import type { RtcRepository } from './repository.js';
import type { RtcService } from './service.js';

/**
 * The live-session contract REALTIME publishes to LIVE.
 *
 * Four operations and no more: open the session that carries an encounter, read
 * its current state, ask a provider for somewhere for it to happen, and end it.
 *
 * What is deliberately absent is everything that decides who may take part.
 * LIVE cannot accept, reject, cancel, extend, revoke, or issue a credential
 * through this contract; a client asks REALTIME for a join credential directly,
 * through the route that re-composes eligibility on every single issuance. A
 * contract that let one domain mint another's credentials would be a second way
 * into calling that nobody reviewed.
 *
 * `mediaTransport` is here because it is the one fact a live surface cannot
 * render honestly without: whether anything is actually carrying audio and
 * video. It is derived from the adapter this process composed rather than from
 * the configuration that was meant to select one, for the same reason the
 * operations screen reports composed adapters — a surface saying "connected"
 * while the process runs no provider is exactly the lie this field exists to
 * prevent.
 */
export class RtcLiveSessions {
  constructor(
    private readonly dependencies: {
      readonly provider: RtcProviderPort;
      readonly repository: RtcRepository;
      readonly service: RtcService;
    },
  ) {}

  get mediaTransport(): 'none' | 'provider' {
    // Read from the adapter's own capability rather than from its name. The
    // `local-test` adapter answers every control operation faithfully and
    // reaches no network at all, so "a provider is configured" and "two people
    // can see each other" are different facts — and the second is the only one
    // a person on a live screen cares about.
    return this.dependencies.provider.capabilities.carriesMedia
      ? 'provider'
      : 'none';
  }

  async openLiveSession(input: {
    readonly first: string;
    readonly liveEncounterId: string;
    readonly medium: RtcCallMedium;
    readonly second: string;
  }): Promise<
    | {
        readonly kind: 'session';
        readonly session: { readonly id: string; readonly state: string };
      }
    | { readonly kind: 'denied' }
  > {
    const outcome = await this.dependencies.service.openLiveSession(input);
    if (outcome.kind === 'denied') return { kind: 'denied' };
    return {
      kind: 'session',
      session: { id: outcome.session.id, state: outcome.session.state },
    };
  }

  endLiveSession(sessionId: string): Promise<boolean> {
    return this.dependencies.service.endLiveSession(sessionId);
  }

  /**
   * Best-effort, and swallowing its own refusals on purpose.
   *
   * With no approved provider this fails the session with
   * `provider_unavailable`, which is a durable, readable, honest state — and
   * the encounter it belongs to stays usable for text, Connect, and Next. The
   * caller has nothing to do with the outcome except read the session state
   * afterwards, which it does anyway.
   */
  async establishProviderSession(sessionId: string): Promise<void> {
    await this.dependencies.service.establishProviderSession(sessionId);
  }

  /**
   * The session's own state, or nothing when there is no such session.
   *
   * A plain read with no membership check, because the only caller is LIVE
   * asking about a session it opened for an encounter it owns — and it has
   * already established that the person asking is in that encounter. Publishing
   * this to anything else would need the membership check REALTIME's own read
   * route performs.
   */
  async readSessionState(sessionId: string): Promise<string | undefined> {
    const found = await this.dependencies.repository.findById(
      this.dependencies.repository.transactionless,
      sessionId,
    );
    return found?.session.state;
  }
}
