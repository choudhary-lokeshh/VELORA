import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { OutboxConsumer, OutboxEvent } from '../events/relay.js';
import type { ClubRepository } from './club-repository.js';

/**
 * PRIVATE CLUBS reading BILLING's commercial facts.
 *
 * The receiving half of the seam. BILLING publishes that a purchase settled or
 * a subscription ended; this decides what that means for access, using its own
 * rules, against its own tables. Neither domain reads the other's storage and
 * neither calls the other synchronously — which is why a commercial reversal
 * revokes through the same door a payment granted through, and why BILLING can
 * change how it decides settlement without touching a single access rule.
 *
 * Delivery is at-least-once, so both handlers are idempotent by construction
 * rather than by checking first: granting relies on the partial unique index
 * over live memberships, and revoking names the state it expects. A redelivered
 * grant changes nothing; a redelivered revocation cannot rewrite when access
 * actually ended.
 *
 * A membership created here carries `source = 'billing'`, which is the value
 * that existed in the vocabulary from the start and that nothing could write
 * until now. Access itself is still re-decided on every protected read from
 * current club, creator, account, and entitlement state — a membership is an
 * input to that decision, never the decision.
 */

/** The shape this consumer requires of a granted fact. Anything else is ignored. */
interface GrantedFact {
  readonly commercialReference?: unknown;
  readonly consumerId?: unknown;
  readonly resourceId?: unknown;
  readonly resourceType?: unknown;
}

function clubFact(
  payload: unknown,
): { readonly clubId: string; readonly memberId: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const fact = payload as GrantedFact;
  // Only clubs, and only well-formed facts. A payload naming a resource type
  // this domain does not own is not an error here — it belongs to somebody
  // else, and treating it as one would make every future resource type an
  // outage in this consumer.
  if (fact.resourceType !== 'club') return undefined;
  if (typeof fact.resourceId !== 'string') return undefined;
  if (typeof fact.consumerId !== 'string') return undefined;
  return { clubId: fact.resourceId, memberId: fact.consumerId };
}

export class BillingEntitlementIntake implements OutboxConsumer {
  constructor(
    readonly eventName: string,
    private readonly dependencies: {
      readonly clubs: ClubRepository;
      readonly database: DatabaseHandle;
      readonly logger: SafeLogger;
      readonly mode: 'grant' | 'revoke';
      readonly now: () => Date;
    },
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const fact = clubFact(event.payload);
    if (fact === undefined) return;
    const { clubs, logger, mode, now } = this.dependencies;

    if (mode === 'grant') {
      // The club has to exist and be somewhere access can be granted. A
      // commercial fact about a club that was closed in the meantime does not
      // create a membership, and it does not fail either: the money is real and
      // the access is refused by current state, which is the case
      // `docs/flows/creator-entitlement.md` describes as reconcilable rather
      // than broken.
      const club = await clubs.findClub(clubs.transactionless, fact.clubId);
      if (club === undefined) return;
      const membership = await clubs.insertMembership(clubs.transactionless, {
        clubId: fact.clubId,
        memberId: fact.memberId,
        now: now(),
        source: 'billing',
      });
      if (membership === undefined) {
        // The partial unique index refused: this person already holds a live
        // entitlement to this club. That is exactly what a redelivered grant
        // should do, and also what a person who was invited and then subscribed
        // should get — one entitlement, not two.
        logger.info(
          { clubId: fact.clubId, eventId: event.id },
          'commercial entitlement already held',
        );
      }
      return;
    }

    const live = await clubs.findMembership(clubs.transactionless, {
      clubId: fact.clubId,
      memberId: fact.memberId,
    });
    // Nothing live to withdraw. A revocation for access that was already ended
    // by a creator, by Admin, or by an earlier delivery of this same fact is a
    // no-op rather than a second revocation record.
    if (live === undefined) return;
    // Only a commercially granted entitlement is withdrawn by a commercial
    // reversal. Somebody who also holds a creator invitation keeps what the
    // creator gave them: the money ending is not the creator changing their
    // mind.
    if (live.source !== 'billing') return;
    await clubs.revokeMembership(clubs.transactionless, {
      membershipId: live.id,
      now: now(),
      state: 'revoked',
    });
  }
}

/** The two facts this domain consumes, built together so neither is forgotten. */
export function billingEntitlementIntakes(dependencies: {
  readonly clubs: ClubRepository;
  readonly database: DatabaseHandle;
  readonly grantedEvent: string;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly revokedEvent: string;
}): readonly OutboxConsumer[] {
  return [
    new BillingEntitlementIntake(dependencies.grantedEvent, {
      clubs: dependencies.clubs,
      database: dependencies.database,
      logger: dependencies.logger,
      mode: 'grant',
      now: dependencies.now,
    }),
    new BillingEntitlementIntake(dependencies.revokedEvent, {
      clubs: dependencies.clubs,
      database: dependencies.database,
      logger: dependencies.logger,
      mode: 'revoke',
      now: dependencies.now,
    }),
  ];
}
