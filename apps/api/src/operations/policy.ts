/**
 * OPERATIONS: what an operator may do, what the platform may be told to do,
 * and what either of those is allowed to record.
 *
 * This module is the vocabulary and nothing else. It holds no state, reads no
 * table, and decides nothing that depends on the world — every value here is a
 * closed list, a bound, or a default, so the rest of the domain can be read
 * against one place that says what the words mean.
 *
 * The domain exists because three things had no owner. Which operator may act
 * was a single boolean hidden inside "is this session Platform Admin". Whether
 * a feature is on was a deploy, so pausing anything meant shipping. And what an
 * operator did was written only where the owning domain happened to keep its
 * own record, which is fine for a moderation decision and leaves nothing at all
 * behind a control being switched.
 *
 * What this domain deliberately does **not** own is product activity. There is
 * no event table here and no recorder anywhere in the codebase writing one,
 * because every fact an operator needs is already persisted by the domain that
 * owns it — a sign-in by AUTH, an encounter by LIVE, a capture by WALLET — and
 * a parallel copy could only ever be a second answer that disagrees with the
 * first. `docs/decisions/ADR-0048-…` argues that at length; the consequence
 * here is that the activity stream is a composed read and this file names its
 * vocabulary rather than its storage.
 */

/* ============================== Capability ============================== */

/**
 * One thing an operator may do, named for the act rather than for the screen.
 *
 * Read is separated from write everywhere, which is the point: the overwhelming
 * majority of operator work is looking, and an account that can only look
 * cannot be turned into an incident by a mistake, a stolen session, or a
 * misread confirmation dialog.
 *
 * `operators.manage` is deliberately its own capability and belongs to exactly
 * one role. An operator who can grant capabilities can grant themselves every
 * other one, so it is the only capability whose holder is unbounded, and it is
 * kept visible rather than folded into a general "admin" idea.
 */
export const operatorCapabilities = [
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
] as const;
export type OperatorCapability = (typeof operatorCapabilities)[number];

/** Every capability that only looks at something. */
const readCapabilities = [
  'audit.read',
  'billing.read',
  'config.read',
  'creators.read',
  'growth.read',
  'live.read',
  'operations.read',
  'safety.read',
  'support.read',
  'users.read',
  'wallet.read',
] as const satisfies readonly OperatorCapability[];

/* ================================= Role ================================= */

/**
 * The named jobs, each a set of capabilities.
 *
 * A role is a convenience over capabilities rather than a thing routes check.
 * Every route in this repository authorizes against a capability, so adding a
 * role can never widen what a route admits, and reading a route tells you
 * exactly what it needs without knowing who holds it.
 *
 * `readonly` is a real role rather than a placeholder. Most incidents start
 * with somebody needing to see something, and an operator who was given only
 * that cannot end an encounter by clicking the wrong row.
 */
export const operatorRoles = [
  'super_admin',
  'operations',
  'safety',
  'support',
  'finance',
  'growth',
  'readonly',
] as const;
export type OperatorRole = (typeof operatorRoles)[number];

export const roleCapabilities: Readonly<
  Record<OperatorRole, readonly OperatorCapability[]>
> = {
  /**
   * Money, and the reads that explain a figure. No enforcement, no controls,
   * and no ability to see a safety case: a reconciliation mismatch is answered
   * with ledgers and payments, not with somebody's report.
   */
  finance: [
    'audit.read',
    'billing.read',
    'billing.refund',
    'operations.read',
    'wallet.read',
  ],
  /**
   * Acquisition and the times VELORA asks people to show up. Growth work needs
   * to know what arrived and to schedule a window; it never needs an account's
   * standing, a ledger, or a case.
   */
  growth: ['growth.manage', 'growth.read', 'operations.read'],
  /**
   * Keeping the platform running. Every read, the live controls, and the
   * feature switches — and deliberately nothing that acts on a person. An
   * outage is fixed by pausing a subsystem, not by suspending somebody.
   */
  operations: [
    ...readCapabilities,
    'config.write',
    'live.control',
    'sessions.revoke',
  ],
  /**
   * The one role that can grant capabilities, and therefore the one whose
   * holder is unbounded. It is kept small on purpose.
   */
  super_admin: [...operatorCapabilities],
  /**
   * Cases, appeals, and what it takes to act on one: the account's standing,
   * its sessions, and the ability to impose. Not money, not controls, and not
   * the ability to grant anybody anything.
   */
  safety: [
    'audit.read',
    'creators.enforce',
    'creators.read',
    'live.read',
    'operations.read',
    'safety.enforce',
    'safety.read',
    'safety.resolve',
    'sessions.revoke',
    'users.read',
    'users.restrict',
  ],
  /**
   * Somebody asking about their own account. Tickets and the context that
   * answers one — the account, what it bought, what it holds — and no power to
   * enforce, because a support conversation is not a safety decision.
   */
  support: [
    'billing.read',
    'creators.read',
    'growth.read',
    'live.read',
    'operations.read',
    'safety.read',
    'support.read',
    'support.update',
    'users.read',
    'wallet.read',
  ],
  /** Everything an operator may look at, and nothing they may change. */
  readonly: [...readCapabilities],
};

export function capabilitiesOfRole(
  role: OperatorRole,
): readonly OperatorCapability[] {
  return roleCapabilities[role];
}

/* =============================== Controls =============================== */

/**
 * One switch the platform actually obeys.
 *
 * Every control here is read by server code on the path it governs, which is
 * the whole rule `docs/domains/operations.md` states and §53 of the phase brief
 * insists on: a hidden button is not a disabled feature. There is no control in
 * this list that only a client consults, and adding one would be a lie with a
 * toggle on it.
 *
 * `defaultEnabled` is what applies when nobody has ever set the control, and it
 * is `true` for every one of them. That is deliberate: these are pause switches
 * over features that already shipped, so the state of a platform nobody has
 * touched is the state it had before this domain existed. A control that
 * defaulted to off would silently disable a working product the first time this
 * migration ran.
 */
export const operationalControls = [
  {
    defaultEnabled: true,
    /**
     * Admits somebody into the matching pool at all. Turning it off stops new
     * searches and leaves every encounter already running alone, which is the
     * semantic §22 asks to be stated rather than guessed: nobody is cut off
     * mid-conversation, and nobody new joins.
     */
    key: 'live.search',
    summary: 'Admits new live searches. Encounters already running continue.',
  },
  {
    defaultEnabled: true,
    /**
     * Mints new invitation links. An existing link keeps working — the code is
     * already in somebody's message and breaking it would punish the person who
     * shared it rather than the abuse.
     */
    key: 'growth.invitations',
    summary: 'Mints new invitation links. Links already shared keep working.',
  },
  {
    defaultEnabled: true,
    /** Publishes scheduled live windows to the public entry page. */
    key: 'growth.scheduled_windows',
    summary: 'Publishes scheduled live windows on public surfaces.',
  },
] as const;

export type ControlKey = (typeof operationalControls)[number]['key'];

export const controlKeys: readonly ControlKey[] = operationalControls.map(
  (control) => control.key,
);

export function controlDefault(key: ControlKey): boolean {
  return (
    operationalControls.find((control) => control.key === key)
      ?.defaultEnabled ?? true
  );
}

export function isControlKey(value: string): value is ControlKey {
  return controlKeys.includes(value as ControlKey);
}

/**
 * How long a control's value may be believed without re-reading it.
 *
 * A control is consulted on paths that run several times a minute per person,
 * and a query per call would put the busiest read in the product behind a table
 * that changes a few times a year. So it is cached, and the cost of caching is
 * stated rather than hidden: a change takes effect within this bound, the API
 * publishes the bound, and the console shows it beside the switch. An operator
 * pausing something in an incident needs to know whether to wait five seconds
 * or five minutes, and being told is the difference between a control they
 * trust and one they press twice.
 */
export const controlCacheMilliseconds = 5_000;

/**
 * When the store cannot be read, the last known value stands.
 *
 * Not the default — the last value. An operator who paused live search during
 * an incident and then lost a database replica must not have the pause quietly
 * reverted by the failure they were reacting to. And where nothing has ever
 * been read, the declared default applies, which is the platform as it shipped.
 */
export const controlFailureBehaviour = 'last-known-value' as const;

/* ============================ Operator actions =========================== */

/**
 * What an operator did, from a closed list.
 *
 * Closed because an audit trail whose vocabulary is a free string is an audit
 * trail nobody can query: three spellings of the same act become three
 * different facts, and the one that matters is always the fourth. A new
 * operator command adds a name here, a CHECK constraint enforces it, and the
 * console can enumerate what it might have to render.
 */
export const operatorActionNames = [
  'control.set',
  'operator.role.granted',
  'operator.role.revoked',
  'sessions.revoked',
] as const;
export type OperatorActionName = (typeof operatorActionNames)[number];

/**
 * What the action was about. `platform` is the whole product, not a record.
 *
 * `encounter` is declared and currently unreachable, deliberately. Ending one
 * person's live encounter from the console was considered and not built: this
 * repository already decided, in ADR-0036 and in REALTIME's and LIVE's
 * enforcement contracts, that ending somebody's call is a safety decision and
 * goes through TRUST & SAFETY where it acquires a record, a reason, and an
 * appeal path. An operator who needs to stop live matchmaking has a global
 * control that touches nobody in particular; an operator who needs to stop one
 * person has a safety decision to make. The vocabulary keeps the word so a
 * later, audited encounter action does not have to migrate this constraint.
 */
export const operatorSubjectTypes = [
  'account',
  'control',
  'encounter',
  'operator',
  'platform',
] as const;
export type OperatorSubjectType = (typeof operatorSubjectTypes)[number];

/**
 * Whether it happened.
 *
 * Three outcomes rather than two, because "the operator asked and the platform
 * said no" is a different fact from "the operator asked and something broke",
 * and an audit that recorded both as failure would hide a refusal an operator
 * needs to see. Nothing here is optimistic: the row is written after the
 * command settles, so a `applied` row means the change is committed.
 */
export const operatorActionOutcomes = ['applied', 'refused', 'failed'] as const;
export type OperatorActionOutcome = (typeof operatorActionOutcomes)[number];

/**
 * A reason, required on every state-changing command.
 *
 * Long enough that "test" does not pass and short enough that nobody pastes a
 * case file into it. It is free text and it is the one free-text field this
 * domain has, which is why it is bounded here rather than trusted to a caller.
 */
export const minimumReasonCharacters = 8;
export const maximumReasonCharacters = 280;

/** A state projection stored beside an action. Never a payload, never content. */
export const maximumStateCharacters = 64;

/* ============================== Activity ================================ */

/**
 * The domains an activity row can come from.
 *
 * This is the filter vocabulary for the composed activity stream. It is a
 * closed list so a query parameter can never reach a table name, and it is
 * named for domains rather than for the tables behind them because which table
 * answers a question is an implementation detail the console must not learn.
 */
export const activityDomains = [
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
] as const;
export type ActivityDomain = (typeof activityDomains)[number];

/**
 * Every kind of fact the activity stream can show, and the domain that owns it.
 *
 * This list is the governed taxonomy §4 asks for. What makes it governed is not
 * that the strings are declared in one place — it is that each one names a row
 * some domain already writes for a product reason, so the taxonomy cannot drift
 * away from the truth: an entry with no source produces nothing, and a source
 * with no entry is invisible rather than mislabelled.
 *
 * There is no `hover`, no `scroll`, no `render`, and no `view`. Every entry is
 * a thing that happened to the product, which is the line §69 draws and the
 * reason this list is short enough to read.
 */
export const activityTypes = [
  { domain: 'auth', type: 'auth.security_event' },
  { domain: 'users', type: 'users.account_created' },
  { domain: 'users', type: 'users.account_status_changed' },
  { domain: 'live', type: 'live.search_entered' },
  { domain: 'live', type: 'live.search_ended' },
  { domain: 'live', type: 'live.encounter_started' },
  { domain: 'live', type: 'live.encounter_ended' },
  { domain: 'discovery', type: 'discovery.introduction_created' },
  { domain: 'discovery', type: 'discovery.introduction_settled' },
  { domain: 'messaging', type: 'messaging.conversation_created' },
  { domain: 'safety', type: 'safety.block_created' },
  { domain: 'safety', type: 'safety.report_submitted' },
  { domain: 'safety', type: 'safety.enforcement_applied' },
  { domain: 'safety', type: 'safety.appeal_submitted' },
  { domain: 'support', type: 'support.ticket_opened' },
  { domain: 'support', type: 'support.ticket_event' },
  { domain: 'wallet', type: 'wallet.transaction_posted' },
  { domain: 'wallet', type: 'wallet.acquisition_settled' },
  { domain: 'billing', type: 'billing.payment_settled' },
  { domain: 'notifications', type: 'notifications.delivery_attempted' },
  { domain: 'growth', type: 'growth.acquisition_event' },
] as const;

export type ActivityType = (typeof activityTypes)[number]['type'];

export const activityTypeNames: readonly ActivityType[] = activityTypes.map(
  (entry) => entry.type,
);

export function isActivityDomain(value: string): value is ActivityDomain {
  return activityDomains.includes(value as ActivityDomain);
}

export function isActivityType(value: string): value is ActivityType {
  return activityTypeNames.includes(value as ActivityType);
}

export function activityTypesOfDomain(
  domain: ActivityDomain,
): readonly ActivityType[] {
  return activityTypes
    .filter((entry) => entry.domain === domain)
    .map((entry) => entry.type);
}

/**
 * What an activity row can be about.
 *
 * Closed, so the console can render a link for each kind and a caller can never
 * push an unknown word into a filter. The list names product records — an
 * encounter, a case, a ticket — rather than the tables behind them, because
 * which table answers a question is an implementation detail a console must not
 * learn.
 */
export const activityResourceTypes = [
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
] as const;
export type ActivityResourceType = (typeof activityResourceTypes)[number];

/**
 * How far back an unbounded activity query looks.
 *
 * Every one of these reads is a union over indexed recency columns, and the
 * bound is what keeps it from becoming a full scan of eleven domains as the
 * product grows. A caller may ask for less; nothing may ask for more, and the
 * response says which window it answered over so a count is never read as
 * all-time.
 */
export const maximumActivityWindowHours = 24 * 30;
export const defaultActivityWindowHours = 24;
export const maximumActivityRows = 100;
export const defaultActivityRows = 50;
