/**
 * SUPPORT policy: what somebody may ask for help with, where a ticket can go,
 * and how much of it one account may create.
 *
 * Everything a support decision depends on is defined once, here, for the same
 * reason every other domain has a policy module: a limit restated in two places
 * is a limit that can be changed in one of them.
 *
 * This domain is deliberately small. It owns tickets and the working record of
 * what an operator did to them, and it owns nothing else. It holds no
 * enforcement, no evidence, no report, no case, and no decision — those are
 * TRUST & SAFETY's and stay there. A support ticket that could restrict an
 * account would be an enforcement path with none of the audit, dual control, or
 * appeal rights the real one has.
 *
 * The bounds below restate published contract values rather than importing
 * them, on the rule the LIVE and MESSAGING policy modules record: `drizzle-kit`
 * reads schema modules through a CommonJS resolver that cannot follow the
 * validation package's import-only exports, so a schema module may not depend
 * on it. `test/unit/support-policy.test.ts` asserts every one of them equals
 * the contract value it mirrors, so drift fails the build.
 */

/** What somebody needs help with. The published vocabulary, restated. */
export const supportCategories = [
  'account_access',
  'live',
  'safety',
  'wallet',
  'messaging',
  'profile',
  'other',
] as const;
export type SupportCategory = (typeof supportCategories)[number];

/**
 * Where a ticket is.
 *
 * `received` is an honest state rather than a polite one: the platform holds
 * it and nobody has looked. Saying anything warmer while nobody is looking is
 * the lie that makes a person stop believing every later status too.
 */
export const supportTicketStatuses = [
  'received',
  'in_review',
  'resolved',
  'closed',
] as const;
export type SupportTicketStatus = (typeof supportTicketStatuses)[number];

/** The states in which a ticket is still somebody's to answer. */
export const openSupportTicketStatuses: readonly SupportTicketStatus[] = [
  'received',
  'in_review',
];

/**
 * Which moves an operator may make.
 *
 * A map rather than a free assignment, because a status is a claim about what
 * happened and not every sequence of claims is coherent. Reopening is
 * permitted from both settled states — an answer that turns out to be wrong is
 * ordinary — and a move to the state a ticket is already in is not a
 * transition at all; the service answers those idempotently rather than
 * recording a second event that says nothing changed.
 */
export const supportStatusTransitions: Readonly<
  Record<SupportTicketStatus, readonly SupportTicketStatus[]>
> = {
  received: ['in_review', 'resolved', 'closed'],
  in_review: ['resolved', 'closed'],
  resolved: ['in_review', 'closed'],
  closed: ['in_review'],
};

export function mayTransition(
  from: SupportTicketStatus,
  to: SupportTicketStatus,
): boolean {
  return (supportStatusTransitions[from] as readonly string[]).includes(to);
}

/** What one thing recorded against a ticket is. Append-only, all of them. */
export const supportEventKinds = ['opened', 'status_changed', 'note'] as const;
export type SupportEventKind = (typeof supportEventKinds)[number];

/** Bounds the database enforces on what somebody wrote. */
export const minimumSupportSubjectCharacters = 3;
export const maximumSupportSubjectCharacters = 120;
export const minimumSupportDescriptionCharacters = 10;
export const maximumSupportDescriptionCharacters = 4_000;
export const maximumSupportNoteCharacters = 1_000;
export const minimumSupportClientTicketIdCharacters = 8;
export const maximumSupportClientTicketIdCharacters = 128;

/**
 * How many tickets one account may open in the window.
 *
 * A cap on volume and never on truth: reaching it refuses a further submission
 * for a while and removes nothing already submitted. It is deliberately
 * generous — somebody having a genuinely bad day may legitimately open several
 * — and what it stops is a script turning the one route that reaches a human
 * into an unbounded write.
 */
export const supportTicketRateLimitCount = 10;
export const supportTicketRateWindowMilliseconds = 24 * 60 * 60 * 1000;

/**
 * How many unanswered tickets one account may hold at once.
 *
 * Separate from the rate bound and stricter, because they stop different
 * things. The rate bound stops a burst; this stops a backlog nobody could
 * answer being built one ticket a day. Somebody at the bound is told to add to
 * what they already have rather than being told to go away.
 */
export const maximumOpenSupportTickets = 5;

export const maximumSupportPageSize = 50;

/**
 * The alphabet a reference is drawn from.
 *
 * Crockford's base32 without `I`, `L`, `O`, and `U`. The first three are the
 * ones a person reads back wrong or types as a digit; the fourth is excluded so
 * a random string cannot spell something somebody has to say out loud to
 * support.
 */
export const supportReferenceAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters per group. Two groups, which is 40 bits of choice. */
export const supportReferenceGroupLength = 4;

/**
 * How many times a colliding reference is regenerated before giving up.
 *
 * A collision is a 1-in-a-million event against a small ticket table, so this
 * is not a hot path. It is bounded anyway, because an unbounded retry against a
 * unique index is how a rare collision becomes an unbounded loop.
 */
export const supportReferenceAttempts = 5;

/**
 * Whether this domain is switched on.
 *
 * There is deliberately no configuration value here and no provider. A support
 * ticket is a row in VELORA's own database, answered by VELORA's own operators
 * through Platform Admin; nothing is bought, nothing is called, and no external
 * service can be unavailable. That is the whole reason this shape was chosen
 * over any hosted help desk: the one path a person uses when everything else
 * has failed them must not itself depend on something that can fail.
 */
export const supportRequiresNoProvider = true;
