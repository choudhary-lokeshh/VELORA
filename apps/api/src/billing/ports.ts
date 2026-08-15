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
  /** Whether this creator may currently operate at all. */
  mayOperate(input: {
    readonly creatorId: string;
    readonly executor: Executor;
  }): Promise<boolean>;
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
    | { readonly adultAssurance: string; readonly inGoodStanding: boolean }
    | undefined
  >;
}
