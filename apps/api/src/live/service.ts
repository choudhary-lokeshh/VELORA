import type { SafeLogger } from '@velora/observability/server';

import type { Executor, TransactionHandle } from '../database/executor.js';
import { lockPair } from '../database/pair-lock.js';
import type {
  ConnectionDirectoryPort,
  PairIntroductionStanding,
} from '../discovery/connections.js';
import type { ConsumerEligibility } from '../users/onboarding.js';
import type { UserAccountRow } from '../users/repository.js';
import {
  liveAbuseWindowMilliseconds,
  liveCandidateScanLimit,
  livePresenceGraceMilliseconds,
  liveRematchSuppressionMilliseconds,
  liveSearchGraceMilliseconds,
  maximumLiveEncountersPerUser,
  maximumLiveMessagesPerEncounter,
  type LiveEndReason,
  type LiveMedium,
} from './policy.js';
import {
  type LiveEncounterRow,
  type LiveMessageRow,
  type LiveParticipationRow,
  type LiveRepository,
} from './repository.js';

/**
 * What a surface renders, assembled once by the domain that knows all of it.
 *
 * One view rather than several endpoints, because the states are mutually
 * exclusive and a client assembling them from separate reads could hold a
 * combination the server never had — searching *and* matched, or matched to an
 * encounter that has ended.
 */
export interface LiveEncounterView {
  readonly call:
    | {
        readonly id: string;
        readonly mediaTransport: 'none' | 'provider';
        readonly medium: LiveMedium;
        readonly state: string;
      }
    | undefined;
  readonly connection: {
    readonly conversationId: string | undefined;
    readonly introductionId: string | undefined;
    readonly state: PairIntroductionStanding['state'];
  };
  readonly endReason: LiveEndReason | undefined;
  readonly endedAt: Date | undefined;
  readonly endedByViewer: boolean;
  readonly id: string;
  readonly messageSequence: number;
  readonly peer: { readonly displayName: string; readonly id: string };
  readonly startedAt: Date;
}

export interface LiveStateView {
  readonly admission: 'eligible' | 'not_eligible' | 'unavailable';
  readonly encounter: LiveEncounterView | undefined;
  readonly medium: LiveMedium | undefined;
  readonly searchingSince: Date | undefined;
  readonly simulated: boolean;
  readonly state: 'idle' | 'searching' | 'matched' | 'ended';
}

export type LiveOutcome =
  | { readonly kind: 'state'; readonly view: LiveStateView }
  /** The account's own standing does not permit live discovery right now. */
  | { readonly kind: 'not_eligible' }
  /** A bound was reached. Says only that, and never which or how much remains. */
  | { readonly kind: 'rate_limited' }
  /** Live discovery is not switched on in this environment. */
  | { readonly kind: 'unavailable' };

export type LiveMessagesOutcome =
  | {
      readonly kind: 'messages';
      readonly encounterId: string;
      readonly messages: readonly LiveMessageRow[];
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'unavailable' };

export type LiveConnectOutcome =
  | {
      readonly kind: 'connection';
      readonly connection: LiveEncounterView['connection'];
      readonly encounterId: string;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'unavailable' };

/** USERS' admission answer, as the narrowest question LIVE asks of it. */
export interface LiveAdmissionPort {
  evaluate(account: UserAccountRow): Promise<ConsumerEligibility>;
}

/** USERS' published account-standing answer, for the person being matched. */
export interface LiveStandingPort {
  isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean>;
}

/** TRUST & SAFETY's pairwise and per-subject answers. */
export interface LiveSafetyPort {
  blockedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly executor: Executor;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>>;
  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}

export interface LiveEnforcementPort {
  decide(input: {
    readonly capability: 'consumer_interaction';
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
  }): Promise<{ readonly allowed: boolean }>;
}

/**
 * REALTIME's live-session contract, as the narrowest slice LIVE needs.
 *
 * Three operations and no more: open the session that carries an encounter,
 * read its current state, and end it. LIVE cannot accept, reject, cancel,
 * extend, or issue a credential for anything — those are REALTIME's decisions
 * and the client asks REALTIME for them directly, through the join-authorization
 * route that already re-composes eligibility on every issuance.
 */
export interface LiveRtcSessionPort {
  /** Whether a configured provider is actually carrying media. */
  readonly mediaTransport: 'none' | 'provider';
  endLiveSession(sessionId: string): Promise<boolean>;
  openLiveSession(input: {
    readonly first: string;
    readonly liveEncounterId: string;
    readonly medium: LiveMedium;
    readonly second: string;
  }): Promise<
    | {
        readonly kind: 'session';
        readonly session: { readonly id: string; readonly state: string };
      }
    | { readonly kind: 'denied' }
  >;
  /**
   * Asks a configured provider for somewhere for this session to happen.
   *
   * Best-effort and outside every transaction, because it is a network call.
   * A provider that is absent fails the session with a reason that says so,
   * which is how a surface comes to display "no provider carries this" rather
   * than a session stuck in `accepted` for ever.
   */
  establishProviderSession(sessionId: string): Promise<void>;
  readSessionState(sessionId: string): Promise<string | undefined>;
}

/** DISCOVERY's introduction signal, as the narrowest slice LIVE needs. */
export interface LiveIntroductionPort {
  signal(
    actor: UserAccountRow,
    counterpartId: string,
  ): Promise<
    | {
        readonly kind: 'introduction';
        readonly view: {
          readonly id: string;
          readonly role: 'initiator' | 'recipient';
          readonly state: 'pending' | 'mutual' | 'closed';
        };
      }
    | { readonly kind: 'not_eligible' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict' }
  >;
}

/** MESSAGING's conversation opener, as the narrowest slice LIVE needs. */
export interface LiveConversationPort {
  openConversation(
    actor: UserAccountRow,
    introductionId: string,
  ): Promise<
    | { readonly kind: 'conversation'; readonly view: { readonly id: string } }
    | { readonly kind: 'not_eligible' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_permitted' }
  >;
}

/** USERS' published directory, for the one thing a peer is shown: a name. */
export interface LiveDirectoryPort {
  namesFor(
    ids: readonly string[],
  ): Promise<readonly { readonly displayName: string; readonly id: string }[]>;
}

/**
 * The deterministic stand-in, when one is configured.
 *
 * It exists so a developer alone in a local world can walk the whole loop. It
 * supplies an account that is already seeded, already admitted, and already
 * eligible — never a fabricated row — and every scenario it applies goes
 * through this service's own published methods, so what is exercised is the
 * product rather than a fixture's idea of it.
 */
export interface LiveSimulationPort {
  /**
   * An account that may be offered to this person as a stand-in, or nothing.
   *
   * Nothing is a complete answer and the surface renders it as "still
   * searching", which is exactly what a real empty pool looks like.
   */
  standInFor(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly viewerId: string;
  }): Promise<UserAccountRow | undefined>;
}

export interface LiveServiceDependencies {
  readonly admission: LiveAdmissionPort;
  readonly connections: ConnectionDirectoryPort;
  readonly conversations: LiveConversationPort;
  readonly directory: LiveDirectoryPort;
  readonly enforcement: LiveEnforcementPort;
  readonly introductions: LiveIntroductionPort;
  readonly logger: SafeLogger;
  /** `false` where configuration has not switched live discovery on. */
  readonly mode: 'open' | 'unavailable';
  readonly now: () => Date;
  readonly realtime: LiveRtcSessionPort;
  readonly repository: LiveRepository;
  readonly safety: LiveSafetyPort;
  /** Absent unless a simulation adapter is configured. */
  readonly simulation?: LiveSimulationPort;
  readonly standing: LiveStandingPort;
}

/**
 * Thrown when an allocation loses a race after it was decided.
 *
 * The transaction is rolled back rather than half-applied: somebody left the
 * pool, or was matched by nothing else but had their participation ended by a
 * safety decision, between this matcher choosing them and writing the choice.
 * The caller answers "still searching", which is true, and the next poll tries
 * again.
 *
 * A private class rather than a sentinel return value because it has to unwind
 * a transaction, and a return value would need every intermediate step to
 * check it.
 */
class LiveAllocationLost extends Error {
  constructor() {
    super('Live allocation lost a race');
  }
}

/**
 * Random live discovery.
 *
 * Five rules shape everything here.
 *
 * **The server chooses.** No request names a person. A client says it wants to
 * meet somebody and the server decides who, if anybody, that is — which is what
 * makes "a stranger cannot be targeted" a property of the contract rather than
 * of a handler.
 *
 * **Nobody is in two places.** One live participation per person and one live
 * encounter per pair, both guaranteed by partial unique indexes rather than by
 * a code path that checked first. Every transition is a guarded update that
 * restates the state it expects, so two people pressing Next at the same instant
 * end one encounter between them and the loser observes it.
 *
 * **Eligibility is composed at the moment of the action, from its owners.** A
 * block, a restriction, a standing that no longer permits contact, an account
 * that has not finished onboarding: each is asked of the domain that owns it,
 * inside the transaction that is about to write, under the pair lock. LIVE
 * introduces no new social relationship and decides none of those facts.
 *
 * **A meeting is not a relationship.** An encounter ends and leaves nothing
 * behind but its own record. What survives is what both people separately chose
 * — an introduction, which DISCOVERY owns, and the conversation that
 * introduction authorizes, which MESSAGING owns. Nothing here writes either.
 *
 * **Nothing is invented.** No online count, no waiting count, no fabricated
 * peer, no simulated activity outside the local adapter that configuration
 * refuses to load anywhere else.
 */
export class LiveService {
  constructor(private readonly dependencies: LiveServiceDependencies) {}

  /**
   * The authoritative read behind every live surface.
   *
   * Deliberately does no matching. A client that is searching asks `search`
   * again, which is idempotent; a client that only wants to know where it
   * stands — after a resume, a reconnect, a tab regaining focus — asks this,
   * and asking it can never move anybody into an encounter they were not
   * already in.
   */
  async read(actor: UserAccountRow): Promise<LiveStateView> {
    if (this.dependencies.mode === 'unavailable') {
      return this.emptyState('unavailable');
    }
    if (!(await this.mayUseLive(actor))) {
      return this.emptyState('not_eligible');
    }

    const now = this.dependencies.now();
    const participation =
      await this.dependencies.repository.findLiveParticipation(
        this.dependencies.repository.transactionless,
        { userId: actor.id },
      );
    if (participation !== undefined) {
      // Reading is presence. There is no gateway and no heartbeat route: a
      // client that is looking at the screen is reading this, and one that has
      // stopped reading has stopped being present. That is the whole presence
      // model, and it is why nothing here publishes a count of anybody.
      await this.dependencies.repository.transaction((executor) =>
        this.dependencies.repository.touchParticipation(executor, {
          id: participation.id,
          now,
        }),
      );
    }
    return this.stateOf(actor, participation);
  }

  /**
   * Enters the matching pool, and takes an allocation if one is available.
   *
   * Idempotent by construction: entering while already searching refreshes
   * presence and tries again, and entering while already matched returns the
   * encounter rather than opening a second search. That is what makes a client
   * safe to poll this — and polling it is exactly what a client does while the
   * screen says "Finding someone".
   */
  async search(
    actor: UserAccountRow,
    medium: LiveMedium,
  ): Promise<LiveOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    let outcome: 'limited' | { readonly encounterId: string | undefined };
    try {
      outcome = await this.dependencies.repository.transaction(
        async (executor) => {
          // One matcher at a time. Everything below reads who is waiting and
          // then chooses two of them, and a pair lock cannot serialize that
          // because neither matcher knows the pair until after it has chosen.
          // Taken before any pair lock, which is what keeps the lock graph
          // acyclic — every other transaction in this domain takes a pair lock
          // and nothing else.
          await this.dependencies.repository.lockMatchmaking(executor);
          return this.enterAndAllocate(executor, actor, medium, now);
        },
      );
    } catch (error) {
      if (!(error instanceof LiveAllocationLost)) throw error;
      // Somebody moved between the choice and the write. Nothing was
      // committed; the honest answer is where this person now stands.
      return { kind: 'state', view: await this.read(actor) };
    }
    if (outcome === 'limited') return { kind: 'rate_limited' };

    // Opening the session and reaching a provider are network-shaped work that
    // must not run inside the transaction that allocated the encounter, for the
    // reason ADR-0019 makes concrete: a pooled connection held across somebody
    // else's network is a connection the admission bound cannot account for.
    if (outcome.encounterId !== undefined) {
      await this.ensureSession(outcome.encounterId);
    }
    return { kind: 'state', view: await this.read(actor) };
  }

  /**
   * Next: ends the named encounter and goes back to searching.
   *
   * The encounter is named by the caller and checked against the one they are
   * actually in, which is what stops a Next that was pressed a second too late
   * from ending the encounter that replaced it. A request naming an encounter
   * that has already ended is not an error — pressing Next twice is ordinary —
   * and is answered with current state.
   */
  async next(actor: UserAccountRow, encounterId: string): Promise<LiveOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    const ended = await this.endEncounter({
      actorId: actor.id,
      encounterId,
      now,
      reason: 'departed',
      resume: true,
    });
    if (ended !== undefined) {
      await this.dependencies.realtime.endLiveSession(ended);
    }
    return { kind: 'state', view: await this.read(actor) };
  }

  /**
   * Leaves live discovery entirely.
   *
   * Ends whatever encounter is in progress, terminates its session, and takes
   * this person out of the pool. It takes no encounter identifier because there
   * is one place a person can be and the server already knows which — and
   * because a leave that named the wrong encounter would be a leave that did
   * not leave.
   */
  async leave(actor: UserAccountRow): Promise<LiveOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }

    const now = this.dependencies.now();
    const participation =
      await this.dependencies.repository.findLiveParticipation(
        this.dependencies.repository.transactionless,
        { userId: actor.id },
      );
    if (participation?.encounterId != null) {
      const ended = await this.endEncounter({
        actorId: actor.id,
        encounterId: participation.encounterId,
        now,
        reason: 'departed',
        resume: false,
      });
      if (ended !== undefined) {
        await this.dependencies.realtime.endLiveSession(ended);
      }
    }
    await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.leavePool(executor, {
        now,
        userId: actor.id,
      }),
    );
    // Read rather than assumed. Leaving is the one action whose result somebody
    // acts on immediately — they are closing the camera — so it reports what is
    // actually true rather than what was intended.
    return { kind: 'state', view: await this.read(actor) };
  }

  /** The messages exchanged inside one encounter the caller was in. */
  async messages(
    actor: UserAccountRow,
    encounterId: string,
  ): Promise<LiveMessagesOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const encounter = await this.dependencies.repository.findEncounter(
      this.dependencies.repository.transactionless,
      encounterId,
    );
    // An encounter somebody is not in is reported exactly as one that does not
    // exist, so an identifier cannot be used to learn that two other people met.
    if (encounter === undefined || !isParticipant(encounter, actor.id)) {
      return { kind: 'not_found' };
    }
    const messages = await this.dependencies.repository.listMessages(
      this.dependencies.repository.transactionless,
      { encounterId, limit: maximumLiveMessagesPerEncounter * 2 },
    );
    return { encounterId, kind: 'messages', messages };
  }

  /**
   * Writes into a live encounter.
   *
   * Nothing written here reaches an Inbox. It belongs to the encounter, it is
   * read through this domain's own contract, and when the encounter ends it
   * stops being reachable by either person — which is the product rule the
   * whole feature is built on, and the reason this is not a conversation with
   * a short life.
   *
   * Safety is re-composed inside the transaction under the pair lock, so a
   * block landing mid-conversation refuses the message being typed rather than
   * the one after it.
   */
  async sendMessage(
    actor: UserAccountRow,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly encounterId: string;
    },
  ): Promise<LiveMessagesOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    const outcome = await this.dependencies.repository.transaction(
      async (executor): Promise<'unknown' | 'denied' | 'limited' | 'sent'> => {
        const found = await this.dependencies.repository.findEncounter(
          executor,
          input.encounterId,
        );
        if (found === undefined || !isParticipant(found, actor.id)) {
          return 'unknown';
        }
        await lockPair(executor, found.pairLowId, found.pairHighId);
        const held = await this.dependencies.repository.lockEncounter(
          executor,
          input.encounterId,
        );
        if (held === undefined) return 'unknown';
        if (held.state !== 'live') return 'denied';
        if (
          !(await this.dependencies.safety.mayInteract({
            executor,
            first: held.pairLowId,
            now,
            second: held.pairHighId,
          }))
        ) {
          return 'denied';
        }

        const written = await this.dependencies.repository.countMessagesFrom(
          executor,
          { encounterId: held.id, senderId: actor.id },
        );
        if (written >= maximumLiveMessagesPerEncounter) return 'limited';

        // The position is allocated from the encounter's own counter under the
        // row lock taken above, so two people typing at the same instant get
        // distinct adjacent positions and neither client's clock participates.
        const sequence =
          await this.dependencies.repository.allocateMessageSequence(executor, {
            id: held.id,
            now,
          });
        if (sequence === undefined) return 'unknown';
        await this.dependencies.repository.insertMessage(executor, {
          body: input.body,
          clientMessageId: input.clientMessageId,
          encounterId: held.id,
          id: crypto.randomUUID(),
          now,
          senderId: actor.id,
          sequence,
        });
        return 'sent';
      },
    );
    if (outcome === 'unknown') return { kind: 'not_found' };
    if (outcome === 'denied') return { kind: 'not_permitted' };
    if (outcome === 'limited') return { kind: 'rate_limited' };
    return this.messages(actor, input.encounterId);
  }

  /**
   * Connect: this person's own interest, signalled once.
   *
   * It goes through DISCOVERY's introduction contract and through nothing else,
   * which is the single most important decision in this feature. A separate
   * "live connection" would be a second, weaker relationship model that
   * eventually disagreed with the first — and it would mean somebody met in
   * Discover and somebody met live were two different kinds of connection with
   * two different inboxes.
   *
   * One tap never produces a mutual connection. The introduction becomes mutual
   * only when the other person has independently signalled too, decided by a
   * compare-and-set inside DISCOVERY's own transaction — so two people pressing
   * Connect at the same instant produce exactly one introduction and exactly one
   * conversation, not two of either.
   */
  async connect(
    actor: UserAccountRow,
    encounterId: string,
  ): Promise<LiveConnectOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const encounter = await this.dependencies.repository.findEncounter(
      this.dependencies.repository.transactionless,
      encounterId,
    );
    if (
      encounter === undefined ||
      !isParticipant(encounter, actor.id) ||
      encounter.state !== 'live'
    ) {
      return { kind: 'not_found' };
    }
    const counterpartId = counterpartOf(encounter, actor.id);

    // Called outside any transaction of this domain's. DISCOVERY opens its own,
    // takes the pair lock inside it, and re-composes every predicate it owns;
    // nesting that inside a LIVE transaction would mean one request holding two
    // pooled connections, which is how a busy pool becomes a stalled one.
    const signalled = await this.dependencies.introductions.signal(
      actor,
      counterpartId,
    );
    if (signalled.kind === 'not_eligible') return { kind: 'not_eligible' };
    if (signalled.kind === 'not_found') return { kind: 'not_permitted' };
    if (signalled.kind === 'conflict') {
      // A concurrent change won. The honest answer is where the pair now
      // stands, read fresh rather than guessed at.
      return {
        connection: await this.connectionOf(actor, counterpartId),
        encounterId,
        kind: 'connection',
      };
    }

    if (signalled.view.state === 'mutual') {
      // The conversation is opened here rather than left for the Inbox to
      // create, so the durable relationship exists the moment both people chose
      // it — not the first time one of them happens to open Messages. It is
      // idempotent by MESSAGING's own unique index over the pair, so both
      // participants doing this produces one conversation.
      await this.dependencies.conversations.openConversation(
        actor,
        signalled.view.id,
      );
    }
    return {
      connection: await this.connectionOf(actor, counterpartId),
      encounterId,
      kind: 'connection',
    };
  }

  /**
   * Closes participations whose client has stopped reading, and the encounters
   * they were in.
   *
   * The only mechanism by which "the other person closed the tab" becomes
   * visible. There is no disconnect event to listen for: a browser tab that is
   * closed sends nothing, a phone that loses signal sends nothing, and a
   * process that was killed sends nothing — so absence is measured rather than
   * announced.
   *
   * Run by the worker on a schedule. Returns what it closed so an operator can
   * see the sweep working rather than infer it from an absence of complaints.
   */
  async sweepLapsedPresence(limit = 100): Promise<{
    readonly encountersEnded: number;
    readonly participationsClosed: number;
  }> {
    const now = this.dependencies.now();
    const lapsed = await this.dependencies.repository.findLapsedParticipations(
      this.dependencies.repository.transactionless,
      {
        encounterSeenBefore: new Date(
          now.getTime() - livePresenceGraceMilliseconds,
        ),
        limit,
        searchSeenBefore: new Date(now.getTime() - liveSearchGraceMilliseconds),
      },
    );

    let encountersEnded = 0;
    let participationsClosed = 0;
    for (const participation of lapsed) {
      const closed = await this.closeLapsedParticipation(participation);
      encountersEnded += closed.encounterEnded ? 1 : 0;
      participationsClosed += closed.participationClosed ? 1 : 0;
    }
    return { encountersEnded, participationsClosed };
  }

  /**
   * Treats one person as having stopped reading, whatever the clock says.
   *
   * Reachable only from the local stand-in, which has to express "this client
   * stopped" from inside the process that is the client. It deliberately
   * performs the *same* work the sweep performs rather than a version of it: a
   * scenario that took a different path would prove the path it took.
   *
   * It skips only the staleness query, which is exactly the fact being
   * simulated.
   */
  async expirePresenceFor(userId: string): Promise<boolean> {
    const participation =
      await this.dependencies.repository.findLiveParticipation(
        this.dependencies.repository.transactionless,
        { userId },
      );
    if (participation === undefined) return false;
    const closed = await this.closeLapsedParticipation(participation);
    return closed.encounterEnded || closed.participationClosed;
  }

  /**
   * Closes one participation whose client is gone, and the encounter it was in.
   *
   * The encounter ends for `presence_lapsed` — never for `departed` — because
   * nobody decided anything: recording an absence as a departure would put a
   * decision in the row that the person never took, and would tell the other
   * side "they moved on" when what happened is that their phone lost signal.
   */
  private async closeLapsedParticipation(
    participation: LiveParticipationRow,
  ): Promise<{
    readonly encounterEnded: boolean;
    readonly participationClosed: boolean;
  }> {
    let encounterEnded = false;
    if (participation.encounterId !== null) {
      const ended = await this.endEncounter({
        actorId: undefined,
        encounterId: participation.encounterId,
        now: this.dependencies.now(),
        reason: 'presence_lapsed',
        resume: false,
      });
      if (ended !== undefined) {
        await this.dependencies.realtime.endLiveSession(ended);
        encounterEnded = true;
      }
    }
    // The person who went quiet leaves the pool. The one who stayed is left on
    // the finished encounter by `endEncounter`, so their surface can say the
    // connection was lost rather than silently replacing them with a spinner.
    const left = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.leavePool(executor, {
        now: this.dependencies.now(),
        userId: participation.userId,
      }),
    );
    return { encounterEnded, participationClosed: left !== undefined };
  }

  /**
   * Ends one encounter, once, and optionally puts both people back in the pool.
   *
   * Returns the identifier of the RTC session that has to be torn down, or
   * nothing when the encounter was already over. The session is ended by the
   * caller *outside* this transaction, because ending it is REALTIME's own
   * transaction and nesting two domains' transactions in one connection is the
   * shape ADR-0019 forbids.
   *
   * `resume` is the difference between Next and leaving. Next puts the person
   * who pressed it back to searching and puts the other person back too —
   * because from their side somebody just left, and the thing they asked for
   * was to meet somebody. Leaving puts nobody back except the person who
   * stayed.
   */
  private async endEncounter(input: {
    readonly actorId: string | undefined;
    readonly encounterId: string;
    readonly now: Date;
    readonly reason: LiveEndReason;
    readonly resume: boolean;
  }): Promise<string | undefined> {
    return this.dependencies.repository.transaction(async (executor) => {
      const found = await this.dependencies.repository.findEncounter(
        executor,
        input.encounterId,
      );
      if (found === undefined) return undefined;
      if (input.actorId !== undefined && !isParticipant(found, input.actorId)) {
        return undefined;
      }
      await lockPair(executor, found.pairLowId, found.pairHighId);
      const held = await this.dependencies.repository.lockEncounter(
        executor,
        input.encounterId,
      );
      if (held?.state !== 'live') return undefined;

      const ended = await this.dependencies.repository.endEncounter(executor, {
        id: held.id,
        now: input.now,
        reason: input.reason,
        ...(input.reason === 'departed' && input.actorId !== undefined
          ? { endedById: input.actorId }
          : {}),
      });
      if (ended === undefined) return undefined;

      // Both people come off the encounter, and neither is silently put back
      // in the queue. Holding them on the finished encounter is what lets each
      // surface say what happened — "you moved on", "they moved on", "the
      // connection was lost" — instead of replacing the person somebody was
      // talking to with a spinner and leaving them to work it out.
      for (const userId of [held.pairLowId, held.pairHighId]) {
        const participation =
          await this.dependencies.repository.findLiveParticipation(executor, {
            userId,
          });
        if (participation?.encounterId !== held.id) continue;
        const settled = await this.dependencies.repository.markEncounterEnded(
          executor,
          { id: participation.id, now: input.now },
        );
        if (settled === undefined) continue;
        // The one exception is the person who pressed Next. They have already
        // said what they want next, so making them press a second button to
        // get it would be the product asking a question it has the answer to.
        if (input.resume && userId === input.actorId) {
          await this.dependencies.repository.resumeSearching(executor, {
            id: participation.id,
            now: input.now,
          });
        }
      }
      return held.realtimeSessionId ?? undefined;
    });
  }

  /**
   * Enters the pool and takes an allocation, inside the matchmaking lock.
   *
   * Split out from `search` only so the transaction body reads as the sequence
   * it is: be in the pool, then see whether anybody is there.
   */
  private async enterAndAllocate(
    executor: TransactionHandle,
    actor: UserAccountRow,
    medium: LiveMedium,
    now: Date,
  ): Promise<'limited' | { readonly encounterId: string | undefined }> {
    const existing = await this.dependencies.repository.findLiveParticipation(
      executor,
      {
        userId: actor.id,
      },
    );
    if (existing?.state === 'matched') {
      await this.dependencies.repository.touchParticipation(executor, {
        id: existing.id,
        now,
      });
      return { encounterId: existing.encounterId ?? undefined };
    }

    let participation = existing;
    if (participation === undefined) {
      // Counted inside the writing transaction, on the same rule every other
      // bound in this repository follows: a count taken outside would be a
      // number that was true a moment ago.
      const recent = await this.dependencies.repository.countRecentEncounters(
        executor,
        {
          since: new Date(now.getTime() - liveAbuseWindowMilliseconds),
          userId: actor.id,
        },
      );
      if (recent >= maximumLiveEncountersPerUser) return 'limited';

      participation =
        (await this.dependencies.repository.insertParticipation(executor, {
          id: crypto.randomUUID(),
          medium,
          now,
          userId: actor.id,
        })) ??
        (await this.dependencies.repository.findLiveParticipation(executor, {
          userId: actor.id,
        }));
      if (participation === undefined) {
        throw new Error('Live participation vanished between insert and read');
      }
    } else {
      await this.dependencies.repository.touchParticipation(executor, {
        id: participation.id,
        now,
      });
      // Somebody sitting on a finished encounter has just asked to meet
      // somebody else, which is the whole meaning of pressing the control. They
      // go back into the pool here rather than staying held on the encounter —
      // without this the allocation below chooses a candidate and then loses to
      // `markMatched`'s `searching` guard, and the person is told "still
      // searching" for ever while the matcher quietly discards a partner every
      // few seconds.
      if (participation.state === 'ended') {
        participation =
          (await this.dependencies.repository.resumeSearching(executor, {
            id: participation.id,
            now,
          })) ?? participation;
      }
      if (participation.state !== 'searching') {
        // A state this domain does not know how to search from. Answered as
        // "not allocated" rather than guessed at, and the caller reads
        // authoritative state.
        return { encounterId: undefined };
      }
    }

    const allocated = await this.allocate(executor, actor, participation, now);
    if (allocated !== undefined) return { encounterId: allocated };

    // Nobody real was available. A configured stand-in enters the pool the same
    // way a person does — a row in the same table, read by the same query — and
    // the allocation below is the same allocation, so what a developer walks is
    // the matcher rather than a shortcut past it.
    const standIn = await this.dependencies.simulation?.standInFor({
      executor,
      now,
      viewerId: actor.id,
    });
    if (standIn === undefined) return { encounterId: undefined };
    const standInParticipation =
      (await this.dependencies.repository.findLiveParticipation(executor, {
        userId: standIn.id,
      })) ??
      (await this.dependencies.repository.insertParticipation(executor, {
        id: crypto.randomUUID(),
        medium: participation.medium,
        now,
        userId: standIn.id,
      }));
    if (standInParticipation?.state !== 'searching') {
      return { encounterId: undefined };
    }
    return {
      encounterId: await this.allocate(executor, actor, participation, now),
    };
  }

  /**
   * Chooses somebody, or nobody.
   *
   * Candidates are read without a row lock and then re-checked under the pair
   * lock before anything is written. That ordering is deliberate and is the
   * reason this domain cannot deadlock with a block: every transaction here
   * takes the pair lock *before* any row lock, and the matchmaking lock — which
   * only this path takes — is always outermost.
   *
   * Every predicate is asked of its owner, at this instant, for both people.
   * The batch read of blocks and recent encounters is an optimization over the
   * candidate list; the per-candidate checks under the pair lock are the
   * authorization, and neither is skipped because the other passed.
   */
  private async allocate(
    executor: TransactionHandle,
    actor: UserAccountRow,
    participation: LiveParticipationRow,
    now: Date,
  ): Promise<string | undefined> {
    const candidates = await this.dependencies.repository.findWaitingCandidates(
      executor,
      {
        limit: liveCandidateScanLimit,
        medium: participation.medium,
        seenSince: new Date(now.getTime() - liveSearchGraceMilliseconds),
        userId: actor.id,
      },
    );
    if (candidates.length === 0) return undefined;

    const candidateIds = candidates.map((row) => row.userId);
    const blocked = await this.dependencies.safety.blockedAmong({
      candidateIds,
      executor,
      viewerId: actor.id,
    });
    const recentlyMet = await this.dependencies.repository.recentlyMetAmong(
      executor,
      {
        candidateIds,
        since: new Date(now.getTime() - liveRematchSuppressionMilliseconds),
        userId: actor.id,
      },
    );

    for (const candidate of candidates) {
      // A blocked pair is skipped before the pair lock is taken, so the common
      // refusal costs nothing. It is asked again below under the lock, because
      // this answer was taken before it.
      if (blocked.has(candidate.userId)) continue;
      if (recentlyMet.has(candidate.userId)) continue;

      await lockPair(executor, actor.id, candidate.userId);
      if (
        !(await this.dependencies.safety.mayInteract({
          executor,
          first: actor.id,
          now,
          second: candidate.userId,
        }))
      ) {
        continue;
      }
      // Both people, not just the one who is searching. An account that has
      // been restricted is not made available by somebody else being in good
      // standing, which is the asymmetry a check on the actor alone would miss.
      if (
        !(await this.dependencies.standing.isDeliverable({
          executor,
          userId: candidate.userId,
        }))
      ) {
        continue;
      }
      const decision = await this.dependencies.enforcement.decide({
        capability: 'consumer_interaction',
        executor,
        now,
        subjectId: candidate.userId,
      });
      if (!decision.allowed) continue;

      const encounter = await this.dependencies.repository.insertEncounter(
        executor,
        {
          first: actor.id,
          id: crypto.randomUUID(),
          medium: participation.medium,
          now,
          second: candidate.userId,
        },
      );
      // The pair already holds a live encounter, which under the matchmaking
      // lock means one of them is in it with somebody. Try the next candidate
      // rather than joining an encounter that is not this one.
      if (encounter === undefined) continue;

      const mine = await this.dependencies.repository.markMatched(executor, {
        encounterId: encounter.id,
        id: participation.id,
        now,
      });
      const theirs = await this.dependencies.repository.markMatched(executor, {
        encounterId: encounter.id,
        id: candidate.id,
        now,
      });
      if (mine === undefined || theirs === undefined) {
        // One of them stopped searching between the read and the write —
        // they left, or a safety decision ended their participation. Nothing
        // half-written survives: the whole transaction is discarded.
        throw new LiveAllocationLost();
      }
      return encounter.id;
    }
    return undefined;
  }

  /**
   * Gives an allocated encounter a live session to happen in.
   *
   * Outside every transaction, and best-effort in exactly one direction: an
   * encounter with no session is a product state a surface can render honestly
   * ("this could not be connected"), whereas a session with no encounter would
   * be a room nobody owes anything about. So the encounter is always written
   * first and the session is opened afterwards, and a failure here leaves the
   * encounter intact.
   */
  private async ensureSession(encounterId: string): Promise<void> {
    const encounter = await this.dependencies.repository.findEncounter(
      this.dependencies.repository.transactionless,
      encounterId,
    );
    if (encounter?.state !== 'live') return;
    if (encounter.realtimeSessionId !== null) return;

    const opened = await this.dependencies.realtime.openLiveSession({
      first: encounter.pairLowId,
      liveEncounterId: encounter.id,
      medium: encounter.medium,
      second: encounter.pairHighId,
    });
    if (opened.kind === 'denied') {
      // REALTIME refused, which means one of the predicates it composes said no
      // between the allocation and now. The encounter ends rather than sitting
      // there with nothing behind it, and it ends for a reason that says the
      // session failed rather than implying anybody left.
      await this.endEncounter({
        actorId: undefined,
        encounterId: encounter.id,
        now: this.dependencies.now(),
        reason: 'session_failed',
        resume: false,
      });
      return;
    }

    const bound = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.bindRealtimeSession(executor, {
        id: encounter.id,
        now: this.dependencies.now(),
        realtimeSessionId: opened.session.id,
      }),
    );
    if (bound === undefined) {
      // Somebody bound it first, or the encounter ended while the session was
      // being opened. The session is torn down rather than left running,
      // because nothing will ever reference it again.
      await this.dependencies.realtime.endLiveSession(opened.session.id);
      return;
    }

    // Reaching a provider is a network call and is deliberately not awaited for
    // correctness: the encounter is already usable for text, Connect, and Next,
    // and the session's own state reports honestly whether media was ever
    // carried. A provider that is absent fails the session with
    // `provider_unavailable`, which is what a surface renders.
    try {
      await this.dependencies.realtime.establishProviderSession(
        opened.session.id,
      );
    } catch (error) {
      this.dependencies.logger.warn(
        { encounterId: encounter.id, error },
        'live encounter could not reach an rtc provider; the encounter stands',
      );
    }
  }

  /**
   * Whether this account may take part in live discovery at all.
   *
   * The same admission standard MESSAGING and REALTIME apply, taken from the
   * same derived eligibility rather than from a second copy of the rule. An
   * account that may not send a message may not meet a stranger on camera
   * either — and that ordering is deliberate, because the second is the more
   * exposing of the two.
   */
  private async mayUseLive(actor: UserAccountRow): Promise<boolean> {
    if (actor.status !== 'active') return false;
    const eligibility = await this.dependencies.admission.evaluate(actor);
    return eligibility.step === 'completed';
  }

  private emptyState(admission: LiveStateView['admission']): LiveStateView {
    return {
      admission,
      encounter: undefined,
      medium: undefined,
      searchingSince: undefined,
      simulated: this.dependencies.simulation !== undefined,
      state: 'idle',
    };
  }

  /**
   * Assembles what a surface renders from what the domains actually say.
   *
   * The peer's name comes from USERS' published directory rather than from
   * anything LIVE stores, because a display name is not this domain's truth and
   * a copy of one would go stale. The session's state comes from REALTIME for
   * the same reason.
   */
  private async stateOf(
    actor: UserAccountRow,
    participation: LiveParticipationRow | undefined,
  ): Promise<LiveStateView> {
    const simulated = this.dependencies.simulation !== undefined;
    if (participation === undefined) {
      // Nobody in the pool. The last encounter, if there was one, is not
      // reported: somebody who left is idle, and showing them the person they
      // walked away from would be a surface remembering something the product
      // deliberately does not.
      return this.emptyState('eligible');
    }
    if (participation.state === 'searching') {
      return {
        admission: 'eligible',
        encounter: undefined,
        medium: participation.medium,
        searchingSince: participation.stateEnteredAt,
        simulated,
        state: 'searching',
      };
    }

    const encounterId = participation.encounterId;
    if (encounterId === null) {
      // The shape check on the table makes this unreachable. Answered rather
      // than thrown, because a surface that cannot render is worse than one
      // that renders the truthful minimum.
      return this.emptyState('eligible');
    }
    const encounter = await this.dependencies.repository.findEncounter(
      this.dependencies.repository.transactionless,
      encounterId,
    );
    if (encounter === undefined) return this.emptyState('eligible');

    const view = await this.encounterView(actor, encounter);
    return {
      admission: 'eligible',
      encounter: view,
      medium: encounter.medium,
      searchingSince: undefined,
      simulated,
      // Taken from where this *person* is rather than from the encounter, so a
      // surface never renders a live encounter to somebody the platform has
      // already taken out of it — which is what a block landing on one side
      // looks like from the other.
      state: participation.state === 'matched' ? 'matched' : 'ended',
    };
  }

  private async encounterView(
    actor: UserAccountRow,
    encounter: LiveEncounterRow,
  ): Promise<LiveEncounterView> {
    const peerId = counterpartOf(encounter, actor.id);
    const [peer] = await this.dependencies.directory.namesFor([peerId]);
    const sessionState =
      encounter.realtimeSessionId === null
        ? undefined
        : await this.dependencies.realtime.readSessionState(
            encounter.realtimeSessionId,
          );
    return {
      call:
        encounter.realtimeSessionId === null || sessionState === undefined
          ? undefined
          : {
              id: encounter.realtimeSessionId,
              mediaTransport: this.dependencies.realtime.mediaTransport,
              medium: encounter.medium,
              state: sessionState,
            },
      connection: await this.connectionOf(actor, peerId),
      endReason: encounter.endReason ?? undefined,
      endedAt: encounter.endedAt ?? undefined,
      endedByViewer: encounter.endedById === actor.id,
      id: encounter.id,
      messageSequence: encounter.messageSequence,
      peer: {
        // A name this platform could not read is rendered as unavailable rather
        // than as an empty string, so a surface never presents a nameless
        // person as though that were their name.
        displayName: peer?.displayName ?? 'Unavailable',
        id: peerId,
      },
      startedAt: encounter.createdAt,
    };
  }

  /**
   * Where the relationship stands, and the conversation it authorizes.
   *
   * The conversation identifier is looked up only when the pair is actually
   * connected, because a conversation cannot exist otherwise — and asking for
   * one that cannot exist would be a read on every render of every encounter.
   */
  private async connectionOf(
    actor: UserAccountRow,
    counterpartId: string,
  ): Promise<LiveEncounterView['connection']> {
    const standing = await this.dependencies.connections.standingFor({
      actorId: actor.id,
      counterpartId,
      now: this.dependencies.now(),
    });
    if (
      standing.state !== 'connected' ||
      standing.introductionId === undefined
    ) {
      return {
        conversationId: undefined,
        introductionId: standing.introductionId,
        state: standing.state,
      };
    }
    const conversation = await this.dependencies.conversations.openConversation(
      actor,
      standing.introductionId,
    );
    return {
      conversationId:
        conversation.kind === 'conversation' ? conversation.view.id : undefined,
      introductionId: standing.introductionId,
      state: 'connected',
    };
  }
}

function isParticipant(encounter: LiveEncounterRow, userId: string): boolean {
  return encounter.pairLowId === userId || encounter.pairHighId === userId;
}

function counterpartOf(encounter: LiveEncounterRow, actorId: string): string {
  return encounter.pairLowId === actorId
    ? encounter.pairHighId
    : encounter.pairLowId;
}
