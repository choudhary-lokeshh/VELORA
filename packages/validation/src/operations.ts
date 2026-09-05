import { z } from 'zod';

/**
 * The operator control plane, as a contract.
 *
 * Everything in this module describes what an operator may ask of the platform
 * and what the platform answers. Three rules run through all of it, and each is
 * enforced by a schema rather than by a convention somebody has to remember.
 *
 * **Closed vocabularies everywhere.** A capability, a role, a control key, an
 * action name, an activity type, a resource type — every one is an enum. A
 * filter that accepted an arbitrary string is a filter somebody eventually
 * probes with something else, and a response field that accepted one is a field
 * a future writer eventually puts a sentence in.
 *
 * **Nothing carries content.** There is no message body, no report narrative,
 * no ticket text, no push token, no provider secret, and no payment instrument
 * anywhere below. Where an operator legitimately needs one of those, it is
 * reached through the case, ticket, or moderation record that justifies it —
 * which is a different route with a different capability and its own audit.
 *
 * **Every changing command states what it was changing from.** A control write
 * carries the version it read; a refusal answers with what actually stands. Two
 * operators looking at the same screen is the normal case during an incident,
 * and the contract is where that stops being a race.
 */

/* ============================== Capability ============================== */

export const operatorCapabilitySchema = z.enum([
  'audit.read',
  'billing.read',
  'billing.refund',
  'config.read',
  'config.write',
  'creators.enforce',
  'creators.read',
  'growth.manage',
  'growth.read',
  'live.control',
  'live.read',
  'operations.read',
  'operators.manage',
  'safety.enforce',
  'safety.read',
  'safety.resolve',
  'sessions.revoke',
  'support.read',
  'support.update',
  'users.read',
  'users.restrict',
  'wallet.read',
]);
export type OperatorCapabilityValue = z.infer<typeof operatorCapabilitySchema>;

export const operatorRoleSchema = z.enum([
  'super_admin',
  'operations',
  'safety',
  'support',
  'finance',
  'growth',
  'readonly',
]);
export type OperatorRoleValue = z.infer<typeof operatorRoleSchema>;

/**
 * Where an operator's capabilities came from.
 *
 * Published rather than hidden, because `bootstrap` means "this machine treats
 * an ungranted operator as a super administrator", which is true only in local
 * and test and is exactly the thing somebody must not mistake for production
 * permissions. The console says it in words on the screen.
 */
export const operatorStandingSourceSchema = z.enum([
  'grant',
  'bootstrap',
  'none',
]);

export const adminOperatorResponseSchema = z
  .object({
    /** Everything this operator may do. Never anybody else's. */
    capabilities: z.array(operatorCapabilitySchema).max(32),
    /** Which environment this console is operating, shown as a banner. */
    environment: z.enum(['local', 'test', 'staging', 'production']),
    role: operatorRoleSchema.optional(),
    source: operatorStandingSourceSchema,
  })
  .strict();
export type AdminOperatorResponse = z.infer<typeof adminOperatorResponseSchema>;

export const adminOperatorGrantSchema = z
  .object({
    grantedAt: z.iso.datetime(),
    /** The operator who granted it. A session reference, never a name. */
    grantedBy: z.string().min(1).max(128).optional(),
    id: z.uuid(),
    reason: z.string().min(1).max(280),
    revokedAt: z.iso.datetime().optional(),
    role: operatorRoleSchema,
    /** The operator this is about, as an opaque AUTH account identifier. */
    subjectReference: z.uuid(),
  })
  .strict();

export const adminOperatorListResponseSchema = z
  .object({
    /**
     * What each role can do, published with the list.
     *
     * So a console never has to hard-code a role's meaning, and so an operator
     * granting one can see what they are handing over before they hand it over.
     */
    catalogue: z
      .array(
        z
          .object({
            capabilities: z.array(operatorCapabilitySchema).max(32),
            role: operatorRoleSchema,
          })
          .strict(),
      )
      .max(16),
    grants: z.array(adminOperatorGrantSchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type AdminOperatorListResponse = z.infer<
  typeof adminOperatorListResponseSchema
>;

/**
 * A reason, required on every command that changes something.
 *
 * Eight characters is enough to refuse "test" and "x" without becoming an
 * essay requirement. It is the one free-text field the control plane has, and
 * bounding it here is what keeps an audit row from becoming a document store.
 */
export const operatorReasonSchema = z.string().trim().min(8).max(280);

export const adminOperatorRoleRequestSchema = z
  .object({
    reason: operatorReasonSchema,
    /**
     * The role to grant, or its absence to revoke.
     *
     * One route rather than two, because granting and revoking are the same
     * decision about the same person and splitting them would let a console
     * revoke without a reason.
     */
    role: operatorRoleSchema.optional(),
    subjectReference: z.uuid(),
  })
  .strict();
export type AdminOperatorRoleRequest = z.infer<
  typeof adminOperatorRoleRequestSchema
>;

export const adminOperatorRoleResponseSchema = z
  .object({
    grant: adminOperatorGrantSchema.optional(),
    /** What actually happened, never an optimistic acknowledgement. */
    outcome: z.enum(['granted', 'revoked', 'unchanged']),
  })
  .strict();
export type AdminOperatorRoleResponse = z.infer<
  typeof adminOperatorRoleResponseSchema
>;

/* =============================== Controls =============================== */

export const operationalControlKeySchema = z.enum([
  'live.search',
  'growth.invitations',
  'growth.scheduled_windows',
]);
export type OperationalControlKeyValue = z.infer<
  typeof operationalControlKeySchema
>;

export const adminControlSchema = z
  .object({
    /** The operator who last wrote it. A session reference, never a name. */
    changedBy: z.string().min(1).max(128).optional(),
    enabled: z.boolean(),
    key: operationalControlKeySchema,
    reason: z.string().min(1).max(280).optional(),
    /** What this control governs, in words, published with its value. */
    summary: z.string().min(1).max(200),
    updatedAt: z.iso.datetime().optional(),
    /**
     * The compare-and-set token. Zero means nobody has ever set this control
     * and the declared default applies, which is a state a write must present
     * exactly like any other.
     */
    version: z.number().int().min(0),
  })
  .strict();

export const adminControlListResponseSchema = z
  .object({
    controls: z.array(adminControlSchema).max(32),
    /**
     * How long a change may take to reach every process, in milliseconds.
     *
     * Published because a control is cached, and an operator pausing something
     * during an incident has to know whether to wait or press again. Calling
     * this instant when it is not would be the kind of small lie that makes an
     * operator stop trusting the whole screen.
     */
    propagationMilliseconds: z.number().int().min(0),
  })
  .strict();
export type AdminControlListResponse = z.infer<
  typeof adminControlListResponseSchema
>;

export const adminControlRequestSchema = z
  .object({
    enabled: z.boolean(),
    /** The version the operator was looking at. A stale one is refused. */
    expectedVersion: z.number().int().min(0),
    key: operationalControlKeySchema,
    reason: operatorReasonSchema,
  })
  .strict();
export type AdminControlRequest = z.infer<typeof adminControlRequestSchema>;

export const adminControlResponseSchema = z
  .object({
    control: adminControlSchema,
    /**
     * `applied` or `conflict`, and the control above is what now stands in
     * either case — so a console showing a conflict shows the operator what
     * they were racing rather than an error with no state in it.
     */
    outcome: z.enum(['applied', 'conflict']),
    propagationMilliseconds: z.number().int().min(0),
  })
  .strict();
export type AdminControlResponse = z.infer<typeof adminControlResponseSchema>;

/* ========================== Operator actions ============================ */

export const operatorActionNameSchema = z.enum([
  'control.set',
  'operator.role.granted',
  'operator.role.revoked',
  'sessions.revoked',
]);

export const operatorActionOutcomeSchema = z.enum([
  'applied',
  'refused',
  'failed',
]);

export const operatorSubjectTypeSchema = z.enum([
  'account',
  'control',
  'encounter',
  'operator',
  'platform',
]);

/**
 * One thing an operator did.
 *
 * Written after the command settled, with the outcome it actually had. A
 * refusal is a row here rather than an absence: an operator who tried to pause
 * live search and was told no is a thing an incident review needs to see, and
 * an audit that recorded only successes would show the incident with a hole in
 * the middle of it.
 */
export const adminOperatorActionSchema = z
  .object({
    action: operatorActionNameSchema,
    actorReference: z.string().min(1).max(128),
    capability: operatorCapabilitySchema,
    correlationId: z.string().min(1).max(128).optional(),
    failureCode: z.string().min(1).max(64).optional(),
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    outcome: operatorActionOutcomeSchema,
    /** A short projection — `enabled`, a role name. Never a payload. */
    previousState: z.string().min(1).max(64).optional(),
    reason: z.string().min(1).max(280),
    requestedState: z.string().min(1).max(64).optional(),
    subjectId: z.string().min(1).max(128).optional(),
    subjectType: operatorSubjectTypeSchema,
  })
  .strict();

export const adminOperatorActionListResponseSchema = z
  .object({
    actions: z.array(adminOperatorActionSchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
    /** The window answered over, so a count is never read as all-time. */
    since: z.iso.datetime(),
  })
  .strict();
export type AdminOperatorActionListResponse = z.infer<
  typeof adminOperatorActionListResponseSchema
>;

/* =============================== Activity =============================== */

export const activityDomainSchema = z.enum([
  'auth',
  'users',
  'live',
  'discovery',
  'messaging',
  'safety',
  'support',
  'wallet',
  'billing',
  'notifications',
  'growth',
]);
export type ActivityDomainValue = z.infer<typeof activityDomainSchema>;

export const activityTypeSchema = z.enum([
  'auth.security_event',
  'users.account_created',
  'users.account_status_changed',
  'live.search_entered',
  'live.search_ended',
  'live.encounter_started',
  'live.encounter_ended',
  'discovery.introduction_created',
  'discovery.introduction_settled',
  'messaging.conversation_created',
  'safety.block_created',
  'safety.report_submitted',
  'safety.enforcement_applied',
  'safety.appeal_submitted',
  'support.ticket_opened',
  'support.ticket_event',
  'wallet.transaction_posted',
  'wallet.acquisition_settled',
  'billing.payment_settled',
  'notifications.delivery_attempted',
  'growth.acquisition_event',
]);
export type ActivityTypeValue = z.infer<typeof activityTypeSchema>;

export const activityResourceTypeSchema = z.enum([
  'account',
  'acquisition',
  'appeal',
  'block',
  'case',
  'conversation',
  'encounter',
  'enforcement',
  'introduction',
  'invite',
  'notification',
  'participation',
  'payment',
  'report',
  'session',
  'ticket',
  'transaction',
]);

/**
 * One thing that happened, from the domain that owns the record of it.
 *
 * There is no payload field and there never will be. `detail` is one short,
 * enumerated word — a state, a reason code, a failure class, a medium — and it
 * is bounded at 64 characters, which is short enough that nobody can smuggle a
 * sentence into it and long enough for every vocabulary this platform actually
 * has.
 */
export const adminActivityEntrySchema = z
  .object({
    actorId: z.uuid().optional(),
    correlationId: z.string().min(1).max(128).optional(),
    detail: z.string().min(1).max(64).optional(),
    domain: activityDomainSchema,
    id: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
    resourceId: z.string().min(1).max(128).optional(),
    resourceType: activityResourceTypeSchema.optional(),
    subjectId: z.uuid().optional(),
    type: activityTypeSchema,
  })
  .strict();
export type AdminActivityEntry = z.infer<typeof adminActivityEntrySchema>;

export const adminActivityResponseSchema = z
  .object({
    entries: z.array(adminActivityEntrySchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
    /** Both ends of the window answered over. Neither is ever implied. */
    since: z.iso.datetime(),
    until: z.iso.datetime(),
  })
  .strict();
export type AdminActivityResponse = z.infer<typeof adminActivityResponseSchema>;

/* ================================ Search ================================ */

export const adminSearchMatchSchema = z
  .object({
    /** A status, a state, a category. Never a name and never content. */
    context: z.string().min(1).max(64).optional(),
    id: z.uuid(),
    kind: z.enum([
      'account',
      'case',
      'conversation',
      'creator',
      'encounter',
      'invite',
      'payment',
      'report',
      'ticket',
    ]),
  })
  .strict();

export const adminSearchResponseSchema = z
  .object({
    /**
     * Exact matches only, and never suggestions.
     *
     * There is no prefix search here and no autocomplete. A suggestion list
     * over identifiers is an enumeration tool: type three characters, learn
     * what exists. Every match is something the operator already held.
     */
    matches: z.array(adminSearchMatchSchema).max(16),
  })
  .strict();
export type AdminSearchResponse = z.infer<typeof adminSearchResponseSchema>;

/* ============================ Account detail ============================ */

export const adminCountSchema = z
  .object({
    label: z.string().min(1).max(64),
    total: z.number().int().min(0),
  })
  .strict();

export const adminAccountSessionSchema = z
  .object({
    audience: z.string().min(1).max(64),
    authenticatedAt: z.iso.datetime(),
    id: z.uuid(),
    lastActiveAt: z.iso.datetime(),
    revocationReason: z.string().min(1).max(64).optional(),
    revokedAt: z.iso.datetime().optional(),
  })
  .strict();

/**
 * A device somebody receives notifications on.
 *
 * The platform, when it was seen, and whether it is disabled. Deliberately not
 * the push token, not the installation identifier, and not a device name — a
 * token is a credential for sending to somebody's phone, and a console with a
 * copy button beside one is a console that eventually leaks it.
 */
export const adminAccountDeviceSchema = z
  .object({
    disableReason: z.string().min(1).max(64).optional(),
    disabledAt: z.iso.datetime().optional(),
    id: z.uuid(),
    lastSeenAt: z.iso.datetime(),
    platform: z.string().min(1).max(32),
    registeredAt: z.iso.datetime(),
  })
  .strict();

export const adminAccountEncounterSchema = z
  .object({
    endReason: z.string().min(1).max(64).optional(),
    endedAt: z.iso.datetime().optional(),
    id: z.uuid(),
    medium: z.string().min(1).max(32),
    startedAt: z.iso.datetime(),
    state: z.string().min(1).max(32),
  })
  .strict();

/**
 * One account, in every operational term and none that are not.
 *
 * What is absent is the design: no display name, no biography, no photograph,
 * no language, no availability, no matching declaration, no message, no report
 * narrative, no ticket text, no push token, and no payment instrument. Every
 * field present was chosen by asking what an operator would do differently if
 * they knew it, and what remains is counts, states, and instants.
 */
export const adminAccountDetailResponseSchema = z
  .object({
    account: z
      .object({
        createdAt: z.iso.datetime(),
        deletionRequestedAt: z.iso.datetime().optional(),
        id: z.uuid(),
        region: z
          .string()
          .regex(/^[A-Z]{2}$/u)
          .optional(),
        status: z.string().min(1).max(32),
        statusChangedAt: z.iso.datetime(),
        statusReason: z.string().min(1).max(64).optional(),
      })
      .strict(),
    /** Where this account came from, if GROWTH recorded an origin for it. */
    acquisition: z
      .object({
        attributedAt: z.iso.datetime(),
        campaign: z.string().min(1).max(64).optional(),
        source: z.string().min(1).max(64),
        viaInvitation: z.boolean(),
      })
      .strict()
      .optional(),
    commerce: z
      .object({
        payments: z.array(adminCountSchema).max(16),
        subscriptions: z.array(adminCountSchema).max(16),
      })
      .strict(),
    connections: z
      .object({
        conversations: z.number().int().min(0),
        introductions: z.array(adminCountSchema).max(16),
      })
      .strict(),
    creator: z
      .object({
        handle: z.string().min(1).max(64).optional(),
        id: z.uuid(),
        publishedAt: z.iso.datetime().optional(),
        status: z.string().min(1).max(32),
      })
      .strict()
      .optional(),
    devices: z.array(adminAccountDeviceSchema).max(20),
    live: z
      .object({
        encounters: z.array(adminAccountEncounterSchema).max(20),
        participation: z
          .object({
            medium: z.string().min(1).max(32),
            since: z.iso.datetime(),
            state: z.string().min(1).max(32),
          })
          .strict()
          .optional(),
      })
      .strict(),
    /** Whether a profile exists at all. Never one word of its contents. */
    profileComplete: z.boolean(),
    safety: z
      .object({
        appeals: z.number().int().min(0),
        blocksMade: z.number().int().min(0),
        blocksReceived: z.number().int().min(0),
        enforcements: z.array(adminCountSchema).max(16),
        reportsAbout: z.number().int().min(0),
        reportsMade: z.number().int().min(0),
      })
      .strict(),
    sessions: z.array(adminAccountSessionSchema).max(20),
    support: z.array(adminCountSchema).max(16),
    /**
     * Coins, as decimal strings.
     *
     * A balance is an exact integer that outgrows what a JSON number can carry
     * safely, and a console that parsed one as a float would eventually show
     * somebody a balance that is wrong and be unable to explain why.
     */
    wallet: z
      .object({
        available: z.string().regex(/^-?\d{1,30}$/u),
        reserved: z.string().regex(/^-?\d{1,30}$/u),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AdminAccountDetailResponse = z.infer<
  typeof adminAccountDetailResponseSchema
>;

export const adminSessionRevocationRequestSchema = z
  .object({
    accountId: z.uuid(),
    reason: operatorReasonSchema,
  })
  .strict();
export type AdminSessionRevocationRequest = z.infer<
  typeof adminSessionRevocationRequestSchema
>;

export const adminSessionRevocationResponseSchema = z
  .object({
    /** Refresh families ended, which is what signs a phone out. */
    families: z.number().int().min(0),
    /** Browser sessions ended. */
    sessions: z.number().int().min(0),
  })
  .strict();
export type AdminSessionRevocationResponse = z.infer<
  typeof adminSessionRevocationResponseSchema
>;

/* ============================== Operations ============================== */

export const adminOutboxStateSchema = z
  .object({
    deadLettered: z.number().int().min(0),
    domain: z.string().min(1).max(32),
    /** How long the oldest undelivered fact has been waiting. */
    oldestPendingAt: z.iso.datetime().optional(),
    pending: z.number().int().min(0),
  })
  .strict();

export const adminFailureFingerprintSchema = z
  .object({
    category: z.string().min(1).max(64),
    domain: z.string().min(1).max(32),
    latestAt: z.iso.datetime(),
    total: z.number().int().min(0),
  })
  .strict();

/**
 * A queue's counters, or the admission that nobody asked it.
 *
 * `reachable: false` with absent counts is a first-class answer. A zero for a
 * broker nothing reached would be reporting health with no evidence behind it,
 * which is the exact failure this whole surface exists to avoid.
 */
export const adminJobQueueSchema = z
  .object({
    active: z.number().int().min(0).optional(),
    completed: z.number().int().min(0).optional(),
    delayed: z.number().int().min(0).optional(),
    failed: z.number().int().min(0).optional(),
    name: z.string().min(1).max(64),
    reachable: z.boolean(),
    waiting: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * A dependency's readiness, in the only four words that are ever true.
 *
 * `unconfigured` is not a failure: it is the accurate description of a
 * provider seam nobody has approved, which is most of them. `unknown` is the
 * answer when the platform did not ask, and it is deliberately different from
 * `unavailable`, which means it asked and got nothing.
 */
export const adminDependencyStateSchema = z.enum([
  'healthy',
  'unavailable',
  'unconfigured',
  'unknown',
]);

export const adminDependencySchema = z
  .object({
    /** What is configured, as a redacted adapter name. Never a credential. */
    adapter: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(64),
    state: adminDependencyStateSchema,
  })
  .strict();

export const adminOperationsStateResponseSchema = z
  .object({
    dependencies: z.array(adminDependencySchema).max(32),
    failures: z.array(adminFailureFingerprintSchema).max(64),
    observedAt: z.iso.datetime(),
    outboxes: z.array(adminOutboxStateSchema).max(16),
    queues: z.array(adminJobQueueSchema).max(16),
    since: z.iso.datetime(),
  })
  .strict();
export type AdminOperationsStateResponse = z.infer<
  typeof adminOperationsStateResponseSchema
>;

/* ================================ Live ================================== */

export const adminLiveStateResponseSchema = z
  .object({
    encounterStarts: z.array(adminCountSchema).max(16),
    endReasons: z.array(adminCountSchema).max(16),
    liveEncounters: z.number().int().min(0),
    observedAt: z.iso.datetime(),
    /**
     * The oldest search still waiting, which is how a stalled matcher shows up.
     * Absent when nobody is searching, which is not an age of zero.
     */
    oldestSearchSince: z.iso.datetime().optional(),
    participations: z.array(adminCountSchema).max(16),
    premiumWindows: z.array(adminCountSchema).max(16),
    /** Whether new searches are currently admitted, and why if not. */
    searchAdmitted: z.boolean(),
    since: z.iso.datetime(),
  })
  .strict();
export type AdminLiveStateResponse = z.infer<
  typeof adminLiveStateResponseSchema
>;

/**
 * One encounter, in operational facts.
 *
 * Two account identifiers, two instants, a reason it stopped, and whether
 * anything followed from it. There is no media here, no transcript, no chat,
 * and no way to reach any of those from here — watching a call is not a feature
 * this product has.
 */
export const adminLiveEncounterResponseSchema = z
  .object({
    createdAt: z.iso.datetime(),
    endReason: z.string().min(1).max(64).optional(),
    endedAt: z.iso.datetime().optional(),
    id: z.uuid(),
    introduction: z
      .object({ createdAt: z.iso.datetime(), state: z.string().min(1).max(32) })
      .strict()
      .optional(),
    medium: z.string().min(1).max(32),
    participants: z.array(z.uuid()).max(2),
    premiumWindows: z.number().int().min(0),
    realtimeSessionId: z.uuid().optional(),
    safety: z
      .object({
        blocks: z.number().int().min(0),
        reports: z.number().int().min(0),
      })
      .strict(),
    state: z.string().min(1).max(32),
  })
  .strict();
export type AdminLiveEncounterResponse = z.infer<
  typeof adminLiveEncounterResponseSchema
>;

/* ============================ Money & entry ============================= */

export const adminWalletEntrySchema = z
  .object({
    amount: z.string().regex(/^-?\d{1,30}$/u),
    businessType: z.string().min(1).max(64),
    direction: z.enum(['credit', 'debit']),
    occurredAt: z.iso.datetime(),
    reason: z.string().min(1).max(64),
    transactionId: z.uuid(),
  })
  .strict();

export const adminWalletResponseSchema = z
  .object({
    available: z.string().regex(/^-?\d{1,30}$/u),
    entries: z.array(adminWalletEntrySchema).max(100),
    /**
     * What the journal says the balance should be.
     *
     * Published beside the stored balance on purpose. The useful operator
     * question is not "what is the balance" but "does the balance follow from
     * what happened", and only a screen showing both can answer it.
     */
    entriesTotal: z.string().regex(/^-?\d{1,30}$/u),
    nextCursor: z.string().min(1).max(64).optional(),
    reserved: z.string().regex(/^-?\d{1,30}$/u),
    userId: z.uuid(),
  })
  .strict();
export type AdminWalletResponse = z.infer<typeof adminWalletResponseSchema>;

export const adminReconciliationFindingSchema = z
  .object({
    /** What this platform means by the finding, in words, beside the number. */
    definition: z.string().min(1).max(300),
    /** Identifiers an operator can open. A finding nobody can chase is noise. */
    examples: z.array(z.uuid()).max(10),
    key: z.string().min(1).max(64),
    total: z.number().int().min(0),
  })
  .strict();

export const adminReconciliationResponseSchema = z
  .object({
    findings: z.array(adminReconciliationFindingSchema).max(16),
    observedAt: z.iso.datetime(),
  })
  .strict();
export type AdminReconciliationResponse = z.infer<
  typeof adminReconciliationResponseSchema
>;

export const adminPublicEntryResponseSchema = z
  .object({
    /** The canonical public address, when one is configured at all. */
    canonicalOrigin: z.url().optional(),
    environment: z.enum(['local', 'test', 'staging', 'production']),
    /**
     * Whether anything at all may be indexed, and both conditions behind it.
     *
     * Published as the decision plus its inputs, so an operator seeing "not
     * indexable" can tell "we are not production" from "nobody configured an
     * origin" without opening a deploy pipeline.
     */
    indexable: z.boolean(),
    liveWindows: z
      .object({
        active: z.number().int().min(0),
        cancelled: z.number().int().min(0),
        upcoming: z.number().int().min(0),
      })
      .strict(),
    observedAt: z.iso.datetime(),
    publishedClubs: z.number().int().min(0),
    publishedCreators: z.number().int().min(0),
  })
  .strict();
export type AdminPublicEntryResponse = z.infer<
  typeof adminPublicEntryResponseSchema
>;
