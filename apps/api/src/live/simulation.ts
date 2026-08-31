import type { LiveSimulationScenario } from '@velora/validation';
import type { SafeLogger } from '@velora/observability/server';

import type { Executor } from '../database/executor.js';
import type { UserAccountRow } from '../users/repository.js';
import type { LiveRepository } from './repository.js';
import type { LiveService, LiveSimulationPort } from './service.js';

/**
 * USERS' bounded list of active accounts, as the narrowest question the local
 * stand-in asks of it.
 *
 * Declared here rather than imported, on the rule
 * `docs/architecture/03-domain-boundaries.md` sets: a consumer declares the
 * contract it needs and the owner supplies it at the composition root. LIVE
 * reads no `users_` table, not even for a local adapter — an exception made for
 * development is an exception that outlives development.
 */
export interface LiveStandInAccountsPort {
  findAccountById(id: string): Promise<UserAccountRow | undefined>;
  listActiveAccounts(input: {
    readonly excludeId: string;
    readonly limit: number;
  }): Promise<readonly UserAccountRow[]>;
}

/** How many accounts are considered before giving up on finding a stand-in. */
const standInScanLimit = 12;

/**
 * The deterministic local stand-in.
 *
 * It exists for one reason: a person building this product is alone in their
 * local world, and every interesting state in random live discovery needs two
 * people. Without this, the only walkable states are "searching" and "nobody is
 * here", and the whole loop — meet, talk, connect, continue in the Inbox, move
 * on — would be unreachable outside a two-browser dance nobody performs often
 * enough to catch what is broken.
 *
 * Three rules make it honest.
 *
 * **The stand-in is a real account.** It is one of the seeded consumers
 * `scripts/seed-local-world.mjs` created through the same HTTP routes a browser
 * calls: a real row, really onboarded, really adult-declared, really eligible.
 * Nothing here fabricates a person, a profile, a photograph, or a presence, and
 * the matcher applies every safety and standing predicate to it exactly as it
 * would to anybody else — so a stand-in that has been blocked is not matched,
 * and one whose account is restricted is not matched.
 *
 * **Every scenario goes through the published service.** "The peer sent a
 * message" is `LiveService.sendMessage` called as that account. "The peer
 * pressed Connect" is `LiveService.connect` called as that account. There is no
 * back door into the tables, so what a developer walks is the product's own
 * behaviour including its refusals — and a scenario that stops working because
 * the product changed is a signal rather than a maintenance chore.
 *
 * **It cannot exist in a deployed environment.** `LIVE_DISCOVERY_SIMULATION` is
 * refused outside local and test by the configuration guard, so this class is
 * never constructed there, the route that reaches it answers `503`, and the
 * matcher has no stand-in to offer. That is a structural guarantee rather than
 * a flag somebody remembers to unset.
 */
export class LiveSimulator implements LiveSimulationPort {
  /**
   * Whose stand-in has been suppressed, for the `nobody_available` scenario.
   *
   * Process-local on purpose. It is a developer's own toggle about their own
   * session, it must not survive a restart, and it must never become a durable
   * fact about a person — which a column would be. It is cleared by any other
   * scenario, so getting out of it is the same gesture as getting into it.
   */
  private readonly suppressed = new Set<string>();

  /** Set late, because the service is constructed with this as a dependency. */
  private service: LiveService | undefined;

  constructor(
    private readonly dependencies: {
      readonly accounts: LiveStandInAccountsPort;
      readonly logger: SafeLogger;
      readonly repository: LiveRepository;
    },
  ) {}

  /**
   * Completes the cycle between the service and this adapter.
   *
   * The service takes this as its `LiveSimulationPort`, and the scenarios below
   * drive the service. That is a genuine cycle in the object graph, resolved
   * here rather than by giving this class its own copy of the service's logic —
   * which is the entire point: a simulator with its own behaviour is a
   * simulator that eventually disagrees with the product.
   */
  attach(service: LiveService): void {
    this.service = service;
  }

  /**
   * An account that may be offered to this person as a stand-in.
   *
   * Chosen deterministically — the longest-registered active consumer that is
   * neither the viewer nor already in the pool — so the same local world
   * produces the same first stand-in every time, and a developer walking a
   * scenario twice sees the same person twice.
   *
   * Returning nothing is a complete answer and renders as "still searching",
   * which is exactly what a real empty pool looks like.
   */
  async standInFor(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly viewerId: string;
  }): Promise<UserAccountRow | undefined> {
    if (this.suppressed.has(input.viewerId)) return undefined;
    const candidates = await this.dependencies.accounts.listActiveAccounts({
      excludeId: input.viewerId,
      limit: standInScanLimit,
    });
    for (const candidate of candidates) {
      // Somebody genuinely in the pool is matched by the ordinary path, and
      // offering them here as well would be this adapter competing with the
      // matcher it stands in for.
      const participation =
        await this.dependencies.repository.findLiveParticipation(
          input.executor,
          { userId: candidate.id },
        );
      if (participation === undefined) return candidate;
    }
    return undefined;
  }

  /**
   * Applies one scenario, as the stand-in.
   *
   * Returns whether anything happened. `false` is an ordinary answer — asking
   * the peer to press Connect when there is no peer is not an error, it is a
   * developer pressing a button in the wrong order — and a surface renders it
   * by simply not changing.
   */
  async apply(input: {
    readonly actor: UserAccountRow;
    readonly scenario: LiveSimulationScenario;
  }): Promise<boolean> {
    if (input.scenario === 'nobody_available') {
      this.suppressed.add(input.actor.id);
      return true;
    }
    // Any other scenario is a developer asking for something to happen, which
    // means they are no longer asking for nothing to happen.
    this.suppressed.delete(input.actor.id);

    const service = this.service;
    if (service === undefined) return false;

    // The two invitation scenarios come before the encounter check, because
    // both are about the state *before* there is an encounter — which is the
    // half of Pick that would otherwise need a second person to walk.
    if (input.scenario === 'peer_invitation') {
      const inviter = await this.standInFor({
        executor: this.dependencies.repository.transactionless,
        now: new Date(),
        viewerId: input.actor.id,
      });
      if (inviter === undefined) return false;
      const outcome = await service.invite(inviter, {
        candidateId: input.actor.id,
        medium: 'video',
      });
      return outcome.kind === 'invitations';
    }
    if (input.scenario === 'peer_accepts_invitation') {
      const current = await service.read(input.actor);
      // Only a request this person sent, and only one nobody has answered.
      // Accepting on somebody's behalf is exactly the thing this adapter must
      // not be able to do, so it finds the invitation and calls the published
      // method as the person entitled to answer it.
      const outgoing = current.invitations.find(
        (invitation) =>
          invitation.direction === 'outgoing' && invitation.state === 'pending',
      );
      if (outgoing === undefined) return false;
      const invitee = await this.dependencies.accounts.findAccountById(
        outgoing.person.id,
      );
      if (invitee === undefined) return false;
      const outcome = await service.respondToInvitation(invitee, {
        invitationId: outgoing.id,
        response: 'accept',
      });
      return outcome.kind === 'invitations';
    }

    const state = await service.read(input.actor);
    const encounter = state.encounter;
    if (encounter === undefined || state.state !== 'matched') return false;
    const peer = await this.dependencies.accounts.findAccountById(
      encounter.peer.id,
    );
    if (peer === undefined) return false;

    switch (input.scenario) {
      case 'peer_message': {
        // A deterministic body, and deliberately a plain one. A scenario that
        // wrote something charming would make the chat panel look better than
        // it is; what is being exercised is the send path, the ordering, and
        // the panel's own layout under a real string.
        const outcome = await service.sendMessage(peer, {
          body: 'Hey — this is the local stand-in saying something back.',
          // Derived from the encounter and its message count, so repeating the
          // scenario writes a new message rather than losing to the idempotency
          // index, and so the same walk produces the same identifiers.
          clientMessageId: `sim-${encounter.id}-${String(
            encounter.messageSequence + 1,
          )}`,
          encounterId: encounter.id,
        });
        return outcome.kind === 'messages';
      }
      case 'peer_connect': {
        const outcome = await service.connect(peer, encounter.id);
        return outcome.kind === 'connection';
      }
      case 'peer_reaction': {
        const outcome = await service.sendReaction(peer, {
          clientMessageId: `sim-${encounter.id}-${String(
            encounter.messageSequence + 1,
          )}`,
          encounterId: encounter.id,
          reaction: 'wave',
        });
        return outcome.kind === 'messages';
      }
      case 'peer_next': {
        const outcome = await service.next(peer, encounter.id);
        return outcome.kind === 'state';
      }
      case 'peer_disconnect': {
        // Not a leave, and the distinction is the whole scenario: leaving is an
        // action the peer takes and the platform hears about, and a disconnect
        // is a client that simply stops saying anything. So this reaches the
        // same presence-lapse path a closed browser tab reaches, skipping only
        // the wait — which is the fact being simulated.
        return service.expirePresenceFor(peer.id);
      }
      default: {
        this.dependencies.logger.warn(
          { scenario: input.scenario },
          'unhandled live simulation scenario',
        );
        return false;
      }
    }
  }
}
