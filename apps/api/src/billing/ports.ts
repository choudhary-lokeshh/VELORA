import type { Executor } from '../database/executor.js';

/**
 * The answers BILLING needs and does not own.
 *
 * Declared here, where they are consumed, so the dependency points from this
 * domain at a contract rather than from this domain into `creators_` or
 * `clubs_`. `docs/architecture/03-domain-boundaries.md` keeps creator
 * eligibility in CREATORS and club state in PRIVATE CLUBS, and lets another
 * domain hold an opaque identifier or call an approved contract, and nothing
 * else.
 *
 * Every method takes the caller's executor, so an eligibility check can be
 * taken inside the transaction it authorizes. A check that commits separately
 * from the write it permits is not a check — and for a commercial activation
 * that gap is the difference between selling access to a published club and
 * selling access to one that was withdrawn a moment earlier.
 */

export interface CommercialCreatorPort {
  /** Minimal published recipient identity for a virtual gift. */
  publishedGiftRecipientFor?(input: {
    readonly executor: Executor;
    readonly handle: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly creatorId: string;
        readonly displayName: string;
        readonly handle: string;
        readonly userId: string;
      }
    | undefined
  >;
  /** Whether this creator may currently operate at all. */
  mayOperate(input: {
    readonly creatorId: string;
    readonly executor: Executor;
  }): Promise<boolean>;
  /**
   * The creator behind a published public page, or nothing.
   *
   * One answer covers an unknown handle, a page that is still a draft, and a
   * creator who is not active, so a caller cannot learn which by asking. What a
   * creator sells is only published where the creator themselves is.
   */
  publishedCreatorFor(input: {
    readonly executor: Executor;
    readonly handle: string;
  }): Promise<string | undefined>;
  /**
   * Which country this creator operates from, or nothing when Velora does not
   * know.
   *
   * Asked of CREATORS rather than derived here, because "where is this creator"
   * is not BILLING's fact to hold and reaching into `creators_` or `users_` to
   * answer it would be the boundary violation this port exists to prevent. An
   * absent answer refuses: a sale from a country nobody approved is exactly
   * what the eligibility gate is for.
   */
  operatingCountryFor(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<string | undefined>;
}

/**
 * What the owning product domain says about a resource an offer points at.
 *
 * Three answers rather than a boolean, because drafting an offer and activating
 * one need different things. A creator may prepare commercial terms for a club
 * they have not published yet; they may not sell access to it until they have.
 * `absent` covers both "no such club" and "not yours", so a caller cannot
 * enumerate another creator's clubs by watching which identifiers answer
 * differently.
 */
export type CommercialResourceState =
  'absent' | 'owned_published' | 'owned_unpublished';

export interface CommercialResourcePort {
  offerableResource(input: {
    readonly creatorId: string;
    readonly executor: Executor;
    readonly resourceId: string;
    readonly resourceType: string;
  }): Promise<CommercialResourceState>;
}

/**
 * Whether a consumer may be charged at all.
 *
 * The same published USERS contract PRIVATE CLUBS uses to decide admission,
 * consumed here for a different question. BILLING does not read `users_` and
 * does not decide what good standing means; it asks, inside the transaction
 * that would write the operation, and refuses when the answer is no or absent.
 */
export interface CommercialConsumerPort {
  standingForUser(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<
    | {
        readonly adultAssurance: string;
        readonly inGoodStanding: boolean;
        /** Where this person told Velora they are. Absent refuses. */
        readonly region: string | undefined;
      }
    | undefined
  >;
}
