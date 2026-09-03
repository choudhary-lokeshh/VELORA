/**
 * Approved V1 messaging policy.
 *
 * Every value a messaging decision depends on is defined once, here, for the
 * same reason the discovery policy module exists: a limit restated in two places
 * is a limit that can be changed in one of them.
 */

/**
 * Message retention.
 *
 * **No retention duration is approved.** It is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, and nothing in this codebase may
 * invent one — not thirty days, not ninety, not a year. A number chosen here to
 * look compliant would be worse than no number, because it would be enforced,
 * would delete evidence a report might need, and would still not be the policy.
 *
 * What that means concretely:
 *
 * - Nothing expires. There is no sweep, no TTL, and no scheduled delete.
 * - No correctness rule depends on a row being physically gone. Ordering,
 *   idempotency, pagination, and authorization are all decided from state that
 *   is present, so applying an approved duration later removes data without
 *   changing how any of them behave.
 * - Production stays closed until the decision exists. See
 *   {@link productionBlockers}.
 */
export const messageRetentionDuration = undefined;

/**
 * Encryption posture, stated so it cannot be quietly misdescribed.
 *
 * Transport is encrypted. Storage is server-readable. **End-to-end encryption
 * is not implemented**, and no surface may claim or imply that it is. The reason
 * is a product one rather than a technical shortfall: moderation, reporting, and
 * lawful safety review on an adults-only platform require server-side authority
 * over message content, and a hand-rolled scheme would trade that away for a
 * guarantee nobody outside this repository could verify.
 */
export const endToEndEncryptionImplemented = false;

/**
 * What has to be decided or built before messaging may be enabled in a deployed
 * environment. Each entry is a real blocker, not a caution.
 *
 * The runtime enforces this rather than merely documenting it: the safety
 * eligibility adapter that permits communication is refused outside development
 * and test, so a deployed environment denies every send instead of running
 * messaging with no Trust & Safety authority behind it.
 */
export const productionBlockers = [
  'message-retention-duration-undecided',
  'trust-and-safety-block-store-not-implemented',
  'post-block-history-visibility-undecided',
] as const;

/**
 * Bounds the database enforces on a message.
 *
 * These restate the published contract's bounds rather than importing them.
 * `drizzle-kit` reads schema modules through a CommonJS resolver that cannot
 * follow the validation package's import-only exports, so a schema module may
 * not depend on it. Restating a bound is only safe if drift is impossible, so
 * `test/unit/messaging-policy.test.ts` asserts each of these equals the
 * contract value it mirrors, and fails the build the moment one moves.
 */
export const maximumMessageBodyCharacters = 4_000;
export const minimumClientMessageIdCharacters = 8;
export const maximumClientMessageIdCharacters = 128;

/**
 * Largest page of messages one read returns.
 *
 * Bounded independently of the requested page size, because a conversation is
 * the one object in the product whose history is unbounded.
 */
/**
 * How many messages one account may send in the window, across every
 * conversation it is in.
 *
 * A cap on automation rather than on conversation. Somebody typing to one
 * person, or to several, comes nowhere near it: it is deliberately generous
 * enough that no ordinary use notices, and low enough that a script cannot turn
 * durable messaging into a delivery pipe. Counting across conversations rather
 * than within one is the point — a per-conversation bound is trivially evaded
 * by opening more of them, and a person who is being messaged at machine speed
 * does not care which conversation it arrived in.
 *
 * It exists because client throttling is not a control. Every send goes through
 * one server path and this is where the bound belongs.
 */
export const maximumMessagesPerWindow = 300;
export const messageRateWindowMilliseconds = 60 * 60 * 1000;

export const maximumMessagePageSize = 50;

/**
 * Largest page of conversations one read returns.
 */
export const maximumConversationPageSize = 50;
