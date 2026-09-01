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
  liveInvitationExpiryMilliseconds,
  liveInvitationOpenStates,
  livePresenceGraceMilliseconds,
  liveRematchSuppressionMilliseconds,
  liveSearchGraceMilliseconds,
  maximumLiveEncountersPerUser,
  maximumLiveInvitationsPerWindow,
  maximumLiveMessagesPerEncounter,
  maximumOpenLiveInvitations,
  type LiveEndReason,
  type LiveInvitationState,
  type LiveMedium,
  type LiveReaction,
} from './policy.js';
import {
  type LiveEncounterRow,
  type LiveInvitationRow,
  type LiveMessageRow,
  type LiveParticipationRow,
  type LivePreferences,
  type LiveRepository,
} from './repository.js';

export type { LivePreferences };

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
  readonly peer: LivePersonView;
  readonly startedAt: Date;
}

/** The other person, in the minimized public shape USERS publishes them in. */
export interface LivePersonView {
  readonly bio: string | undefined;
  readonly displayName: string;
  readonly id: string;
  readonly region: string | undefined;
  readonly sharedLanguages: readonly string[];
}

export interface LiveInvitationView {
  readonly createdAt: Date;
  readonly direction: 'outgoing' | 'incoming';
  readonly expiresAt: Date;
  readonly id: string;
  readonly medium: LiveMedium;
  readonly person: LivePersonView;
  readonly state: LiveInvitationState;
}

export interface LiveStateView {
  readonly admission: 'eligible' | 'not_eligible' | 'unavailable';
  readonly encounter: LiveEncounterView | undefined;
  readonly invitations: readonly LiveInvitationView[];
  /** The languages this person may narrow to, which are their own. */
  readonly languageOptions: readonly string[];
  readonly medium: LiveMedium | undefined;
  readonly preferences: LivePreferences;
  /**
   * The paid narrowing currently in force, when there is one.
   *
   * Reported so a surface can say what the search is actually doing. It is a
   * statement about this caller's own search and is never shown to the person
   * they meet: nobody is told why they were selected.
   */
  readonly premium:
    | {
        /** Whether the coins have already been charged for this window. */
        readonly charged: boolean;
        readonly expiresAt: Date;
        readonly gender: string | undefined;
        readonly language: string | undefined;
        readonly region: string | undefined;
      }
    | undefined;
  readonly searchingSince: Date | undefined;
  readonly simulated: boolean;
  readonly state: 'idle' | 'searching' | 'matched' | 'ended';
}

export type LiveInvitationsOutcome =
  | {
      readonly kind: 'invitations';
      readonly views: readonly LiveInvitationView[];
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_permitted' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'unavailable' };

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

/**
 * USERS' published directory, for the little this domain shows about a person.
 *
 * Four questions, and each is one another domain owns the answer to. LIVE keeps
 * no copy of any of them: a display name, a region, and a language list are
 * USERS' facts, and a copy here would be a fact that went stale the moment
 * somebody moved, renamed themselves, or learned a language — while also being
 * the cross-domain read `docs/architecture/03-domain-boundaries.md` forbids.
 *
 * `matchingAmong` is deliberately a membership answer over identifiers the
 * caller already holds. It never returns a region or a language, so applying a
 * preference cannot become a way to read where somebody lives.
 */
export interface LiveDirectoryPort {
  /** The caller's own languages, which bound what they may narrow to. */
  languagesOf(userId: string): Promise<readonly string[]>;
  /**
   * Which of these people satisfy the narrowing a search asked for.
   *
   * Every criterion is conjunctive, and the answer is membership over
   * identifiers the caller already holds — so applying a preference never
   * becomes a way to read where somebody lives, what they speak, or what they
   * have declared about themselves.
   */
  matchingAmong(input: {
    /** The matcher's own connection. A second one would deadlock the pool. */
    readonly executor: Executor;
    readonly gender?: string | undefined;
    readonly ids: readonly string[];
    readonly language: string | undefined;
    readonly region: string | undefined;
  }): Promise<ReadonlySet<string>>;
  namesFor(
    ids: readonly string[],
  ): Promise<readonly { readonly displayName: string; readonly id: string }[]>;
  /** The minimized public profile, as one consumer may see another's. */
  profilesFor(input: {
    readonly ids: readonly string[];
    readonly viewerLanguages: readonly string[];
  }): Promise<
    readonly {
      readonly bio: string | null;
      readonly displayName: string;
      readonly id: string;
      readonly region: string | null;
      readonly sharedLanguages: readonly string[];
    }[]
  >;
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

/**
 * DISCOVERY's answer to "may these two be introduced right now".
 *
 * Asked before one person may ask another to meet live, and asked of the domain
 * that owns the question rather than re-derived here. Picking somebody is the
 * one action in this domain that names a person, so it is the one action that
 * needs the predicate ordinary discovery applies — otherwise a harvested
 * identifier would reach somebody who has turned discoverability off.
 *
 * Random matching deliberately does *not* consult this: the matcher puts
 * together people who were never each other's candidates, which is the whole
 * point of it, and requiring feed eligibility there would quietly turn random
 * discovery into a second Discover feed.
 */
export interface LiveIntroducibilityPort {
  mayBeIntroducedTo(
    viewer: UserAccountRow,
    candidateId: string,
    now: Date,
  ): Promise<boolean>;
}

/**
 * WALLET's published answer about a paid, bounded narrowing, as the narrowest
 * slice LIVE needs.
 *
 * Two operations. Read what somebody has bought, and say that it produced
 * something. LIVE cannot open a window, price one, refund one, or read a
 * balance through this contract — those are WALLET's decisions and a client
 * asks WALLET for them directly.
 *
 * The order the two are used in is the whole design. The narrowing is applied
 * to the candidate *pool*, before any safety, standing, or enforcement
 * predicate is asked, so paying can only ever make the pool smaller. Nothing
 * here is consulted by any predicate that decides whether two people may meet,
 * which is what makes "paying never overrides safety" a property of the shape
 * rather than of a comment.
 */
export interface LivePremiumPreferencePort {
  /**
   * The narrowing this person currently holds, if any.
   *
   * Read on the matcher's own executor, inside the transaction that is about to
   * allocate, so a window that expired a second ago is not applied to a match
   * made now.
   */
  activeLivePreference(
    executor: Executor,
    userId: string,
  ): Promise<
    | {
        /**
         * Whether the window has already been charged.
         *
         * Carried so the matcher can skip a capture it knows will be refused,
         * and for nothing else. A charged window narrows exactly as an
         * uncharged one does: this is not a permission and there is no branch
         * anywhere in this domain where it makes a match more likely.
         */
        readonly charged: boolean;
        readonly entitlementId: string;
        readonly expiresAt: Date;
        /** A declared matching category. Never `undisclosed`, never inferred. */
        readonly gender?: string | undefined;
        /** A declared profile language the buyer also speaks. */
        readonly language?: string | undefined;
        /** A declared ISO 3166-1 alpha-2 region. */
        readonly region?: string | undefined;
      }
    | undefined
  >;
  /**
   * The windows held by any of these candidates, keyed by person.
   *
   * Asked about the bounded candidate list this matcher is already considering,
   * and about nobody else. It exists because a narrowing that only applied to
   * the buyer's own search would be a filter that worked in one direction: the
   * person who paid to meet only women would still be handed a man the instant
   * his search picked them.
   *
   * It carries no price and no balance. What comes back is the predicate and
   * the identity of the window, which is exactly what is needed to decide
   * whether this pair may be put together and whose window to charge.
   */
  activeLivePreferencesAmong(
    executor: Executor,
    userIds: readonly string[],
  ): Promise<
    ReadonlyMap<
      string,
      {
        readonly charged: boolean;
        readonly entitlementId: string;
        readonly expiresAt: Date;
        readonly gender?: string | undefined;
        readonly language?: string | undefined;
        readonly region?: string | undefined;
      }
    >
  >;
  /**
   * Charges the window, because it produced the encounter it was bought for.
   *
   * Runs inside the matcher's transaction on purpose: the encounter and the
   * charge commit together or neither does. A charge without an encounter would
   * be money for nothing, and an encounter without a charge would be a narrowed
   * match nobody paid for.
   */
  captureLivePreference(
    executor: TransactionHandle,
    input: {
      readonly encounterId: string;
      readonly entitlementId: string;
      readonly userId: string;
    },
  ): Promise<boolean>;
}

export interface LiveServiceDependencies {
  readonly admission: LiveAdmissionPort;
  readonly connections: ConnectionDirectoryPort;
  readonly conversations: LiveConversationPort;
  readonly directory: LiveDirectoryPort;
  readonly enforcement: LiveEnforcementPort;
  readonly introducibility: LiveIntroducibilityPort;
  readonly introductions: LiveIntroductionPort;
  readonly logger: SafeLogger;
  /** `false` where configuration has not switched live discovery on. */
  readonly mode: 'open' | 'unavailable';
  readonly now: () => Date;
  /**
   * Absent where no coin ledger is configured, which is every deployed
   * environment. Its absence means no search is ever narrowed by a paid
   * preference and nothing is ever charged — free random matching is the whole
   * product, exactly as it is today.
   */
  readonly premium?: LivePremiumPreferencePort;
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
    preferences?: LivePreferences,
  ): Promise<LiveOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    // Narrowed to what this person actually speaks before it reaches storage.
    // A language somebody does not speak is not a preference, it is a filter
    // over other people, and the contract is deliberately unable to express one
    // — this is where that stops being a comment and starts being enforced.
    const wanted = await this.narrowedPreferences(actor, preferences);
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
          return this.enterAndAllocate(executor, actor, medium, now, wanted);
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
    return this.writeLine(actor, { ...input, kind: 'text' });
  }

  /**
   * One line into an encounter, typed or tapped.
   *
   * Shared by both because both are the same write with the same guarantees:
   * one bounded body, one idempotency key, one position allocated from the
   * encounter's own counter under its row lock, and safety re-composed inside
   * the transaction so a block landing mid-conversation refuses the line being
   * sent rather than the one after it.
   */
  private async writeLine(
    actor: UserAccountRow,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly encounterId: string;
      readonly kind: 'text' | 'reaction';
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
          kind: input.kind,
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
    preferences: LivePreferences,
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
          preferences,
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
      // Broadening or narrowing mid-search takes effect on the next attempt,
      // which is this one. It deliberately does not restart the wait: somebody
      // who has been looking for two minutes and then widens their net should
      // keep their place in the queue rather than pay for having tried.
      if (
        participation.preferredRegion !== preferences.region ||
        (participation.preferredLanguage ?? undefined) !== preferences.language
      ) {
        participation =
          (await this.dependencies.repository.setPreferences(executor, {
            id: participation.id,
            now,
            preferences,
          })) ?? participation;
      }
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
        // The stand-in casts the widest net there is. It stands in for whoever
        // would have been there, and a stand-in that had preferences of its own
        // would make the local walkthrough disagree with the product.
        preferences: { language: undefined, region: 'any' },
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
    const seenSince = new Date(now.getTime() - liveSearchGraceMilliseconds);
    // People who already agreed to meet this person come first, and they are a
    // separate read rather than a sort key over the pool: an agreement is a
    // reason to pair two people, and folding it into the ordering of a scan
    // that is bounded at twenty would mean an agreement quietly falling off the
    // end of a busy pool.
    const agreed = await this.dependencies.repository.findAgreedCandidates(
      executor,
      {
        limit: liveCandidateScanLimit,
        medium: participation.medium,
        now,
        seenSince,
        userId: actor.id,
      },
    );
    const agreedIds = new Set(agreed.map((row) => row.userId));
    const pool = await this.dependencies.repository.findWaitingCandidates(
      executor,
      {
        limit: liveCandidateScanLimit,
        medium: participation.medium,
        seenSince,
        userId: actor.id,
      },
    );
    // What this person has paid to narrow to, read inside the transaction that
    // is about to allocate. A window that expired a second ago is not applied
    // to a match made now, and one that is open is applied to the pool only —
    // never to a safety, standing, or enforcement answer below.
    const premium = await this.dependencies.premium?.activeLivePreference(
      executor,
      actor.id,
    );
    // A preference narrows the pool and never the people who chose each other.
    // Two people who agreed to meet have already answered the question a
    // preference asks, and a filter that then kept them apart would be the
    // product overruling both of them.
    const narrowed = await this.narrowPool(
      executor,
      actor,
      participation,
      pool,
      premium,
    );
    // Who the *paid* narrowing actually admitted, kept as its own set rather
    // than inferred later. It is what decides whether anybody is charged, and
    // deriving that from "a window was open and this was not an agreed
    // candidate" would be one refactor away from charging for a match the
    // filter had nothing to do with.
    const premiumNarrowed = new Set(
      premium === undefined ? [] : narrowed.map((row) => row.userId),
    );
    const candidates = [
      ...agreed,
      ...narrowed.filter((row) => !agreedIds.has(row.userId)),
    ];
    if (candidates.length === 0) {
      // A paid narrowing that found nobody, which is the one outcome worth an
      // operator's attention: it is what "somebody bought a filter and met
      // nobody" looks like from the inside. Debug rather than info, because a
      // poll happens every few seconds and the durable count of it is the
      // sweep's `released` figure — coins actually handed back.
      //
      // Kinds and never values, on the rule WALLET's own logs follow: which
      // categories are being bought is operational, and which one this person
      // chose is theirs.
      if (premium !== undefined) {
        this.dependencies.logger.debug(
          {
            kinds: (['gender', 'region', 'language'] as const).filter(
              (kind) => premium[kind] !== undefined,
            ),
            pool: pool.length,
          },
          'paid narrowing matched nobody in the pool',
        );
      }
      return undefined;
    }

    const candidateIds = candidates.map((row) => row.userId);
    // The other half of a paid narrowing: whatever *they* bought has to hold
    // too. A filter that only applied to the buyer's own search would be a
    // filter that worked in one direction — somebody who paid to meet only
    // women would still be handed a man the moment his search picked them, and
    // the thing they paid for would quietly be worth nothing.
    const counterpartWindows = await this.satisfiedCounterparts(
      executor,
      actor,
      candidateIds,
    );
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
      // Rematch suppression stops the *matcher* handing back somebody you just
      // moved on from. It deliberately does not apply to a pair who asked to
      // meet: they named each other, and refusing them because they met an hour
      // ago would be suppression acting as a rule about people rather than
      // about randomness. A block still refuses them, above and below.
      if (
        !agreedIds.has(candidate.userId) &&
        recentlyMet.has(candidate.userId)
      ) {
        continue;
      }
      // Their window, if they hold one. Skipped for a pair who asked to meet,
      // exactly as this person's own narrowing is: two people who named each
      // other have already answered the question a preference asks, and a
      // filter that then kept them apart would be the product overruling both
      // of them.
      const counterpart = agreedIds.has(candidate.userId)
        ? undefined
        : counterpartWindows.get(candidate.userId);
      if (counterpart?.satisfied === false) continue;

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
      // Any request to meet between these two is spent, however they came to be
      // paired. An agreement that survived the meeting it asked for would be
      // redeemable again an hour later, against somebody who has since moved
      // on from wanting it.
      await this.dependencies.repository.markInvitationMet(executor, {
        first: actor.id,
        now,
        second: candidate.userId,
      });
      // The window produced what it was bought for, so it is charged — in this
      // transaction, with the encounter, or not at all.
      //
      // Three conditions, and each removes a way of charging for something that
      // did not happen. The candidate has to have come through the *paid*
      // narrowing, so a pair who had already agreed to meet — who bypass it by
      // design — is never a charge for a filter that was not used. The window
      // has to be uncharged, so the second and every later match inside the
      // fifteen minutes is free. And it is inside the allocation's own
      // transaction, so a charge without an encounter and an encounter without
      // a charge are both unreachable rather than unlikely.
      //
      // Nothing about the provider is consulted. LiveKit carries a match; it
      // does not decide whether one was made, and a session that fails to open
      // afterwards ends the encounter without unwinding the charge — the
      // narrowing did find somebody, which is what was sold.
      if (
        premium !== undefined &&
        !premium.charged &&
        this.dependencies.premium !== undefined &&
        premiumNarrowed.has(candidate.userId)
      ) {
        await this.dependencies.premium.captureLivePreference(executor, {
          encounterId: encounter.id,
          entitlementId: premium.entitlementId,
          userId: actor.id,
        });
      }
      // And theirs, on exactly the same terms. Their window did the same work —
      // it is why this pair is allowed at all — and charging only the person
      // who happened to press the button last would make what somebody pays
      // depend on whose poll arrived first.
      if (
        counterpart !== undefined &&
        !counterpart.charged &&
        this.dependencies.premium !== undefined
      ) {
        await this.dependencies.premium.captureLivePreference(executor, {
          encounterId: encounter.id,
          entitlementId: counterpart.entitlementId,
          userId: candidate.userId,
        });
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
   *
   * The provider is reached *before* the session is bound to the encounter, and
   * that ordering is the whole of what makes the identifier this publishes
   * usable. Binding first advertises a call identifier to both clients while
   * the room it names does not exist yet, and REALTIME correctly refuses a join
   * credential for a session with no room — so the person who read the
   * encounter inside that window was told they could not join a call they were
   * in fact in. It was a real race between two real browsers: the person who
   * did not trigger the match polled 375ms before the room existed, was
   * refused, and never joined. Reaching the provider first closes the window at
   * its source rather than asking every client to tolerate it.
   *
   * The session is bound whatever the provider answered, because a session that
   * failed to reach one is a fact the encounter has to carry: the surface reads
   * that state and says the camera and voice could not be connected, which is
   * the truth. An encounter with no session at all says something different and
   * would be a lie here.
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

    // Reaching a provider is a network call, so it happens here rather than in
    // any transaction. Its outcome does not decide whether the session is
    // bound: the encounter is usable for text, Connect, and Next either way,
    // and the session's own state is what reports honestly whether media was
    // ever carried. A provider that is absent fails the session with
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

    const bound = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.bindRealtimeSession(executor, {
        id: encounter.id,
        now: this.dependencies.now(),
        realtimeSessionId: opened.session.id,
      }),
    );
    if (bound === undefined) {
      // Losing this write is the ordinary case, not a failure, and what it
      // means has to be established rather than assumed.
      //
      // Every poll by somebody already matched runs this, so two runs for one
      // encounter overlap routinely — and `openLiveSession` answers the second
      // with the *same* session rather than opening a another one, on purpose.
      // So the session in hand is usually the one the winner has just
      // published, and ending it would tear down a call the other person is
      // already in. That is exactly what happened against a real provider: one
      // browser was connected and publishing, the other's poll lost the bind
      // and ended the session underneath it, and the platform then correctly
      // refused every credential for a call that no longer existed.
      //
      // So the encounter is asked what it now names. Naming this session is
      // success by somebody else's hand; naming anything else — or nothing,
      // because the encounter ended while the provider was being reached —
      // means nothing will ever reference it, and it is torn down. The room, if
      // one was created, is discharged by the termination obligation
      // `establishProviderSession` recorded while the reference was in hand.
      const current = await this.dependencies.repository.findEncounter(
        this.dependencies.repository.transactionless,
        encounter.id,
      );
      if (current?.realtimeSessionId === opened.session.id) return;
      await this.dependencies.realtime.endLiveSession(opened.session.id);
      return;
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

  /**
   * Which candidates hold a paid window, and whether this person satisfies it.
   *
   * Two round trips at most in the common case and none at all when nobody in
   * the pool is paying: one read of the candidates' windows, then one
   * membership question per *distinct* selection among them. Distinct rather
   * than per candidate, because a pool where eight people all bought "women in
   * France" is one question, not eight.
   *
   * The question is asked of USERS as a membership test over this person's own
   * identifier, which is the whole privacy design. LIVE never learns what
   * anybody declared — not the candidates' and not the actor's own. It learns
   * one bit per window: whether this pair is allowed. Reading the actor's
   * attributes here instead would have put a special-category value into a
   * domain that has no use for one.
   */
  private async satisfiedCounterparts(
    executor: TransactionHandle,
    actor: UserAccountRow,
    candidateIds: readonly string[],
  ): Promise<
    ReadonlyMap<
      string,
      {
        readonly charged: boolean;
        readonly entitlementId: string;
        readonly satisfied: boolean;
      }
    >
  > {
    const answers = new Map<
      string,
      {
        readonly charged: boolean;
        readonly entitlementId: string;
        readonly satisfied: boolean;
      }
    >();
    const windows = await this.dependencies.premium?.activeLivePreferencesAmong(
      executor,
      candidateIds,
    );
    if (windows === undefined || windows.size === 0) return answers;

    const verdicts = new Map<string, boolean>();
    for (const [candidateId, window] of windows) {
      const key = `${window.gender ?? ''}|${window.language ?? ''}|${window.region ?? ''}`;
      let satisfied = verdicts.get(key);
      if (satisfied === undefined) {
        const matching = await this.dependencies.directory.matchingAmong({
          executor,
          gender: window.gender,
          ids: [actor.id],
          language: window.language,
          region: window.region,
        });
        satisfied = matching.has(actor.id);
        verdicts.set(key, satisfied);
      }
      answers.set(candidateId, {
        charged: window.charged,
        entitlementId: window.entitlementId,
        satisfied,
      });
    }
    return answers;
  }

  /**
   * The subset of the pool this person asked the matcher to consider.
   *
   * Both criteria are asked of USERS, on the matcher's own connection, and both
   * come back as a membership answer over identifiers this domain already had —
   * so applying a preference never becomes a way to read where somebody lives
   * or what they speak.
   *
   * A narrowing that leaves nobody is answered as nobody. The surface says the
   * search is still narrowed and offers to broaden it; what it never does is
   * quietly ignore the preference and hand over somebody who does not match,
   * which is the failure that would make the control worthless.
   */
  private async narrowPool(
    executor: TransactionHandle,
    actor: UserAccountRow,
    participation: LiveParticipationRow,
    pool: readonly LiveParticipationRow[],
    premium?: {
      readonly gender?: string | undefined;
      readonly language?: string | undefined;
      readonly region?: string | undefined;
    },
  ): Promise<readonly LiveParticipationRow[]> {
    // A bought window names the region. Otherwise `same` means the region this
    // account is in — and somebody whose account has no region cannot ask for
    // people in it, so the honest reading of that is "no narrowing" rather than
    // "nobody": a person with no region set would otherwise be silently unable
    // to match at all.
    //
    // The paid narrowing wins over the free one where both name the same
    // dimension, because it is the more specific thing the person asked for and
    // it is the one they paid for. Intersecting them instead would mean a free
    // "people who speak Spanish" and a bought "people who speak French"
    // producing a search for people who speak both, which is not what either
    // control says it does. It is still only a narrowing either way: it removes
    // candidates from the pool and can never add one.
    const language =
      premium?.language ?? participation.preferredLanguage ?? undefined;
    const region =
      premium?.region ??
      (participation.preferredRegion === 'same'
        ? (actor.region ?? undefined)
        : undefined);
    const gender = premium?.gender;
    if (pool.length === 0) return pool;
    if (
      gender === undefined &&
      language === undefined &&
      region === undefined
    ) {
      return pool;
    }
    const matching = await this.dependencies.directory.matchingAmong({
      executor,
      gender,
      ids: pool.map((row) => row.userId),
      language,
      region,
    });
    return pool.filter((row) => matching.has(row.userId));
  }

  /**
   * The preferences this search will actually be made under.
   *
   * A language the caller does not speak is dropped rather than refused: the
   * request is well-formed, the narrowing is simply not one this product
   * offers, and the state that comes back says which preferences are being
   * applied — so a surface shows the truth rather than a control that appears
   * to have taken effect.
   */
  private async narrowedPreferences(
    actor: UserAccountRow,
    wanted: LivePreferences | undefined,
  ): Promise<LivePreferences> {
    if (wanted === undefined) return { language: undefined, region: 'any' };
    if (wanted.language === undefined) {
      return { language: undefined, region: wanted.region };
    }
    const spoken = await this.dependencies.directory.languagesOf(actor.id);
    return {
      language: spoken.includes(wanted.language) ? wanted.language : undefined,
      region: wanted.region,
    };
  }

  /**
   * Asks one person to meet live.
   *
   * The one action in this domain that names somebody, and it is gated on
   * DISCOVERY's own answer to whether these two may be introduced right now —
   * so an identifier harvested from anywhere reaches somebody who has turned
   * discoverability off exactly as often as a signal from the feed would, which
   * is never.
   *
   * It promises a request and never a meeting. Both people still have to be
   * here at the same time, and when they are, every predicate the random
   * matcher composes is composed again in the same order.
   */
  async invite(
    actor: UserAccountRow,
    input: { readonly candidateId: string; readonly medium: LiveMedium },
  ): Promise<LiveInvitationsOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };
    if (input.candidateId === actor.id) return { kind: 'not_found' };

    const now = this.dependencies.now();
    // Asked before the transaction, because it is DISCOVERY's read over its own
    // tables and this domain holds no lock worth keeping across it. It is a
    // point-in-time answer, and everything that authorizes an actual encounter
    // is asked again under the pair lock when one is allocated.
    if (
      !(await this.dependencies.introducibility.mayBeIntroducedTo(
        actor,
        input.candidateId,
        now,
      ))
    ) {
      return { kind: 'not_found' };
    }

    const outcome = await this.dependencies.repository.transaction(
      async (executor): Promise<'sent' | 'denied' | 'limited'> => {
        await lockPair(executor, actor.id, input.candidateId);
        if (
          !(await this.dependencies.safety.mayInteract({
            executor,
            first: actor.id,
            now,
            second: input.candidateId,
          }))
        ) {
          return 'denied';
        }
        if (
          !(await this.dependencies.standing.isDeliverable({
            executor,
            userId: input.candidateId,
          }))
        ) {
          return 'denied';
        }
        const decision = await this.dependencies.enforcement.decide({
          capability: 'consumer_interaction',
          executor,
          now,
          subjectId: input.candidateId,
        });
        if (!decision.allowed) return 'denied';

        const existing =
          await this.dependencies.repository.findOpenInvitationForPair(
            executor,
            { first: actor.id, forUpdate: true, second: input.candidateId },
          );
        // An open request between these two already carries this intent,
        // whichever of them opened it. Asking again is answered with what
        // stands rather than with a second request neither could resolve.
        if (existing !== undefined && existing.expiresAt > now) return 'sent';

        // Counted inside the writing transaction, like every other bound here.
        const open = await this.dependencies.repository.countOpenInvitations(
          executor,
          { userId: actor.id },
        );
        if (open >= maximumOpenLiveInvitations) return 'limited';
        const sent = await this.dependencies.repository.countInvitationsSince(
          executor,
          {
            since: new Date(now.getTime() - liveAbuseWindowMilliseconds),
            userId: actor.id,
          },
        );
        if (sent >= maximumLiveInvitationsPerWindow) return 'limited';

        // An expired request is retired before a new one is written, because
        // the open-pair index does not know about time and would otherwise
        // refuse the second request for ever.
        if (existing !== undefined) {
          await this.dependencies.repository.transitionInvitation(executor, {
            from: [...liveInvitationOpenStates],
            id: existing.id,
            now,
            to: 'expired',
          });
        }
        const written = await this.dependencies.repository.insertInvitation(
          executor,
          {
            expiresAt: new Date(
              now.getTime() + liveInvitationExpiryMilliseconds,
            ),
            id: crypto.randomUUID(),
            inviterId: actor.id,
            medium: input.medium,
            now,
            subjectId: input.candidateId,
          },
        );
        // Lost the index to a concurrent identical request. That request is
        // this request, so the answer is the same.
        return written === undefined ? 'sent' : 'sent';
      },
    );
    if (outcome === 'denied') return { kind: 'not_permitted' };
    if (outcome === 'limited') return { kind: 'rate_limited' };
    return { kind: 'invitations', views: await this.invitationsFor(actor) };
  }

  /**
   * Accepts, declines, or withdraws a request to meet.
   *
   * Accepting does not open a live session, and deliberately says so by moving
   * to a state that means "agreed, and not both here yet". The alternative —
   * allocating an encounter on the spot — would be a product that puts somebody
   * into a live video call because a person who is not there tapped a button.
   *
   * Which answer each side may give is decided here rather than trusted from
   * the request: accept is the recipient's and cancel is the sender's, and the
   * wrong one is refused rather than reinterpreted as the right one.
   */
  async respondToInvitation(
    actor: UserAccountRow,
    input: {
      readonly invitationId: string;
      readonly response: 'accept' | 'decline' | 'cancel';
    },
  ): Promise<LiveInvitationsOutcome> {
    if (this.dependencies.mode === 'unavailable') {
      return { kind: 'unavailable' };
    }
    if (!(await this.mayUseLive(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    const outcome = await this.dependencies.repository.transaction(
      async (executor): Promise<'applied' | 'unknown' | 'denied'> => {
        const found = await this.dependencies.repository.findInvitation(
          executor,
          { id: input.invitationId },
        );
        if (found === undefined || !isInvitationParticipant(found, actor.id)) {
          return 'unknown';
        }
        await lockPair(executor, found.pairLowId, found.pairHighId);
        const held = await this.dependencies.repository.findInvitation(
          executor,
          { forUpdate: true, id: input.invitationId },
        );
        if (held === undefined) return 'unknown';
        if (!isInvitationOpen(held)) return 'denied';
        // Expired on read. There is no sweep, so a request past its bound is
        // retired the moment somebody looks at it rather than answered.
        if (held.expiresAt <= now) {
          await this.dependencies.repository.transitionInvitation(executor, {
            from: [...liveInvitationOpenStates],
            id: held.id,
            now,
            to: 'expired',
          });
          return 'denied';
        }

        const sender = held.inviterId === actor.id;
        if (input.response === 'cancel' && !sender) return 'denied';
        if (input.response !== 'cancel' && sender) return 'denied';
        if (input.response === 'accept' && held.state !== 'pending') {
          return 'denied';
        }
        if (input.response === 'accept') {
          // Re-composed at the moment of agreement rather than trusted from
          // when the request was sent. A block or a restriction that landed in
          // between refuses the acceptance, and says no more than that.
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
        }
        const applied = await this.dependencies.repository.transitionInvitation(
          executor,
          {
            from: [...liveInvitationOpenStates],
            id: held.id,
            now,
            to:
              input.response === 'accept'
                ? 'accepted'
                : input.response === 'decline'
                  ? 'declined'
                  : 'cancelled',
          },
        );
        return applied === undefined ? 'denied' : 'applied';
      },
    );
    if (outcome === 'unknown') return { kind: 'not_found' };
    if (outcome === 'denied') return { kind: 'not_permitted' };
    return { kind: 'invitations', views: await this.invitationsFor(actor) };
  }

  /**
   * Every request to meet that is still worth showing this person.
   *
   * Expiry is applied here rather than by a sweep, so an environment where
   * nothing has run still shows the truth.
   */
  private async invitationsFor(
    actor: UserAccountRow,
  ): Promise<readonly LiveInvitationView[]> {
    const now = this.dependencies.now();
    const rows = await this.dependencies.repository.listOpenInvitations(
      this.dependencies.repository.transactionless,
      { limit: maximumOpenLiveInvitations * 4, userId: actor.id },
    );
    const live = rows.filter((row) => row.expiresAt > now);
    if (live.length === 0) return [];
    const people = await this.peopleFor(
      actor,
      live.map((row) => counterpartOfPair(row, actor.id)),
    );
    return live.map((row) => {
      const personId = counterpartOfPair(row, actor.id);
      return {
        createdAt: row.createdAt,
        direction: row.inviterId === actor.id ? 'outgoing' : 'incoming',
        expiresAt: row.expiresAt,
        id: row.id,
        medium: row.medium,
        person: people.get(personId) ?? unknownPerson(personId),
        state: row.state,
      };
    });
  }

  /**
   * Sends one of the six reactions.
   *
   * The same write a message is, through the same bound, the same idempotency
   * key, and the same safety re-composition — because it is the same thing to
   * moderate. What differs is entirely in the rendering: a reaction is a moment
   * on the video and never a line of transcript.
   */
  async sendReaction(
    actor: UserAccountRow,
    input: {
      readonly clientMessageId: string;
      readonly encounterId: string;
      readonly reaction: LiveReaction;
    },
  ): Promise<LiveMessagesOutcome> {
    return this.writeLine(actor, {
      body: input.reaction,
      clientMessageId: input.clientMessageId,
      encounterId: input.encounterId,
      kind: 'reaction',
    });
  }

  /** The minimized public profile of each of these people, keyed by id. */
  private async peopleFor(
    actor: UserAccountRow,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, LivePersonView>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const languages = await this.dependencies.directory.languagesOf(actor.id);
    // `profilesFor` narrows languages to the overlap with the viewer, and
    // answers nothing at all for a viewer who has declared none. A person still
    // has to be nameable in that case, so the name is read separately and the
    // context is simply absent — which is the truthful rendering of "this
    // platform knows of no shared language".
    const profiles =
      languages.length === 0
        ? []
        : await this.dependencies.directory.profilesFor({
            ids: unique,
            viewerLanguages: languages,
          });
    const byId = new Map<string, LivePersonView>();
    for (const profile of profiles) {
      byId.set(profile.id, {
        bio: profile.bio ?? undefined,
        displayName: profile.displayName,
        id: profile.id,
        region: profile.region ?? undefined,
        sharedLanguages: profile.sharedLanguages,
      });
    }
    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      for (const name of await this.dependencies.directory.namesFor(missing)) {
        byId.set(name.id, {
          bio: undefined,
          displayName: name.displayName,
          id: name.id,
          region: undefined,
          sharedLanguages: [],
        });
      }
    }
    return byId;
  }

  private emptyState(
    admission: LiveStateView['admission'],
    extra?: {
      readonly invitations: readonly LiveInvitationView[];
      readonly languageOptions: readonly string[];
      readonly premium?: LiveStateView['premium'];
    },
  ): LiveStateView {
    return {
      admission,
      encounter: undefined,
      invitations: extra?.invitations ?? [],
      languageOptions: extra?.languageOptions ?? [],
      medium: undefined,
      preferences: { language: undefined, region: 'any' },
      premium: extra?.premium,
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
    // Sequential, not concurrent. Each of these reads takes its own pooled
    // connection, so running them together lets one in-flight request hold
    // several at once — the pool deadlock DISCOVERY's candidate walk records.
    const languageOptions = await this.dependencies.directory.languagesOf(
      actor.id,
    );
    const invitations = await this.invitationsFor(actor);
    // Reported whether or not this person is in the pool. Somebody who
    // activated a window and then left is still holding one, still being
    // charged nothing yet, and still owed the truth about it.
    const held = await this.dependencies.premium?.activeLivePreference(
      this.dependencies.repository.transactionless,
      actor.id,
    );
    const premium =
      held === undefined
        ? undefined
        : {
            charged: held.charged,
            expiresAt: held.expiresAt,
            gender: held.gender,
            language: held.language,
            region: held.region,
          };
    const preferences: LivePreferences = {
      language: participation?.preferredLanguage ?? undefined,
      region: participation?.preferredRegion ?? 'any',
    };
    if (participation === undefined) {
      // Nobody in the pool. The last encounter, if there was one, is not
      // reported: somebody who left is idle, and showing them the person they
      // walked away from would be a surface remembering something the product
      // deliberately does not.
      return this.emptyState('eligible', {
        invitations,
        languageOptions,
        premium,
      });
    }
    if (participation.state === 'searching') {
      return {
        admission: 'eligible',
        encounter: undefined,
        invitations,
        languageOptions,
        medium: participation.medium,
        preferences,
        premium,
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
      return this.emptyState('eligible', { invitations, languageOptions });
    }
    const encounter = await this.dependencies.repository.findEncounter(
      this.dependencies.repository.transactionless,
      encounterId,
    );
    if (encounter === undefined) {
      return this.emptyState('eligible', {
        invitations,
        languageOptions,
        premium,
      });
    }

    const view = await this.encounterView(actor, encounter);
    return {
      admission: 'eligible',
      encounter: view,
      invitations,
      languageOptions,
      medium: encounter.medium,
      preferences,
      premium,
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
    const people = await this.peopleFor(actor, [peerId]);
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
      // A person this platform could not read is rendered as unavailable rather
      // than as an empty string, so a surface never presents a nameless person
      // as though that were their name.
      peer: people.get(peerId) ?? unknownPerson(peerId),
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

function counterpartOfPair(
  row: { readonly pairHighId: string; readonly pairLowId: string },
  actorId: string,
): string {
  return row.pairLowId === actorId ? row.pairHighId : row.pairLowId;
}

function isInvitationParticipant(
  invitation: LiveInvitationRow,
  userId: string,
): boolean {
  return invitation.pairLowId === userId || invitation.pairHighId === userId;
}

function isInvitationOpen(invitation: LiveInvitationRow): boolean {
  return liveInvitationOpenStates.includes(invitation.state);
}

/**
 * Somebody this platform could not read.
 *
 * A named absence rather than an empty string, so no surface can present a
 * missing name as though it were the person's name.
 */
function unknownPerson(id: string): LivePersonView {
  return {
    bio: undefined,
    displayName: 'Unavailable',
    id,
    region: undefined,
    sharedLanguages: [],
  };
}
