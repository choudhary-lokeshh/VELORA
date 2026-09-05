import type { SafeLogger } from '@velora/observability/server';

import type { Executor } from '../database/executor.js';
import type { UserAccountRow, UsersRepository } from './repository.js';

/**
 * Closing an account, and what that actually means today.
 *
 * The competitor complaint is specific and common: the Delete Account button
 * does not delete anything, and often does not even exist — the settings screen
 * tells somebody to email support and nothing happens. VELORA had the second
 * shape of that problem. The lifecycle vocabulary and the columns were here
 * from `0002_users`, and no route or screen reached any of it, so a person
 * could not leave.
 *
 * What this does is deliberately the half VELORA can actually honour, and it
 * says so rather than implying the other half.
 *
 * **Closure is immediate and total.** The account stops being usable the moment
 * it is requested: every session and refresh family is revoked, every push
 * registration is retired, the person leaves live discovery and any encounter
 * they were in ends, and their availability window is closed. Every product
 * predicate in the repository already reads `pending_profile` or `active` for
 * good standing, so `deletion_pending` loses discovery, messaging, calling,
 * live, and delivery in one transition rather than through a list of
 * cooperating changes somebody could forget to extend.
 *
 * **Erasure is not claimed.** Physically destroying what remains depends on
 * retention schedules that are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`
 * across messaging, safety evidence, financial records, identity evidence, and
 * media — see `docs/decisions/DECISIONS_REQUIRED.md`. Inventing a destruction
 * period here would be the one retention error that cannot be undone. So the
 * status a person reads back says what is true: the account is closed, nobody
 * can reach them, and what remains follows VELORA's retention schedule, which
 * is not yet published.
 *
 * **Financial and safety records are not touched, and that is not a loophole.**
 * A closed account's journal entries, reports, and enforcement records stay
 * exactly where they are, because they are somebody else's evidence or a
 * statutory obligation, and because [account deletion](../../../../docs/flows/account-deletion.md)
 * makes USERS responsible for coordinating deletion rather than for performing
 * everybody else's.
 *
 * **There is no undo in the product.** A window in which a closure can be
 * reversed is a retention and consent decision nobody has taken, and offering
 * one would mean holding an account open for a period this code invented. The
 * confirmation is where the caution lives.
 */

/** What AUTH is asked to do when somebody closes their account. */
export interface ClosureAuthorityPort {
  /**
   * Revokes every session and refresh family the AUTH account holds.
   *
   * The AUTH account identifier, not the consumer one: they are deliberately
   * different values, and handing this the wrong one would be a closure that
   * revoked nothing.
   */
  revokeAllAuthority(input: {
    readonly accountId: string;
    readonly correlationId: string;
  }): Promise<void>;
}

/** What NOTIFICATIONS is asked to do. Retire, never delete. */
export interface ClosureDestinationPort {
  retireDevices(recipientId: string): Promise<number>;
}

/** What LIVE is asked to do: take them out of the pool and end what is running. */
export interface ClosureLivePort {
  endLiveEncountersForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number>;
}

/**
 * What REALTIME is asked to do.
 *
 * Separate from LIVE because they are separate rows with separate owners:
 * ending the RTC session that carries a random encounter does not end the
 * encounter, and ending the encounter does not tear down the session. A block
 * already has to do both and does; a closure has exactly the same obligation,
 * and asking only one of them would leave somebody's camera connected to a
 * room their account no longer exists for.
 */
export interface ClosureCallPort {
  endLiveCallsForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number>;
}

/**
 * What GROWTH is asked to do: stop the person's link working.
 *
 * Separate from everything else because it is the one obligation that is not
 * about reachability. Nobody can reach a closed account through its invitation
 * — an invitation names nobody — but the link would keep bringing people in on
 * behalf of somebody who left, and attributing them to an account that is gone.
 */
export interface ClosureInvitationPort {
  withdrawInvitesFor(userId: string): Promise<number>;
}

/** What USERS' own availability service is asked to do. */
export interface ClosureAvailabilityPort {
  close(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<void>;
}

export interface AccountClosureView {
  readonly requestedAt: Date;
  readonly status: ClosingStatus;
}

export type AccountClosureOutcome =
  | { readonly kind: 'closed'; readonly view: AccountClosureView }
  /** The account is in a state closure does not act on. */
  | { readonly kind: 'not_permitted' };

export type AccountClosureStatusOutcome =
  | { readonly kind: 'closing'; readonly view: AccountClosureView }
  /** Nothing has been requested; the account is ordinary. */
  | { readonly kind: 'open' };

type CloseableStatus = 'pending_profile' | 'active' | 'restricted';
type ClosingStatus = 'deletion_pending' | 'deactivated' | 'erased';

/** The statuses a closure request may act on. */
const closeableStatuses: readonly string[] = [
  'pending_profile',
  'active',
  'restricted',
];

function isCloseable(status: string): status is CloseableStatus {
  return closeableStatuses.includes(status);
}

/**
 * The statuses that mean a closure has already been requested.
 *
 * All three, not only the first. `deactivated` and `erased` are later stages a
 * retention pass performs, and somebody whose account reached one of them has
 * already left — answering their request with a refusal would be telling them
 * their closure did not happen.
 */
const closingStatuses: readonly string[] = [
  'deletion_pending',
  'deactivated',
  'erased',
];

function isClosing(status: string): status is ClosingStatus {
  return closingStatuses.includes(status);
}

export class AccountClosureService {
  constructor(
    private readonly dependencies: {
      readonly authority: ClosureAuthorityPort;
      readonly availability: ClosureAvailabilityPort;
      readonly calls?: ClosureCallPort;
      readonly destinations: ClosureDestinationPort;
      readonly invitations?: ClosureInvitationPort;
      readonly live?: ClosureLivePort;
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly repository: UsersRepository;
    },
  ) {}

  /**
   * Closes an account, and takes away everything it could still be used for.
   *
   * Idempotent by construction. An account already closing is reported as
   * closing rather than refused: somebody who taps twice, or whose response was
   * lost, is asking for the state they already have, and answering that with an
   * error would leave them unsure whether it worked.
   *
   * The transition commits first and the propagation follows. That order is
   * deliberate and the failure it protects against is the dangerous one: if the
   * status lands and a later step fails, the account is already refused
   * everywhere by the standing predicate every domain already asks, and the
   * remaining steps are repair. Propagating first and failing to transition
   * would leave an account that had been signed out and was still fully usable
   * the moment somebody signed back in.
   */
  async close(input: {
    readonly account: UserAccountRow;
    readonly correlationId: string;
  }): Promise<AccountClosureOutcome> {
    const now = this.dependencies.now();
    const { account } = input;
    // Captured before the transaction below, because a narrowing on a property
    // does not survive into a closure and the compare-and-set needs the exact
    // status this method decided on.
    const current = account.status;

    if (isClosing(current)) {
      return {
        kind: 'closed',
        view: {
          requestedAt: account.deletionRequestedAt ?? account.statusChangedAt,
          status: current,
        },
      };
    }
    if (!isCloseable(current)) return { kind: 'not_permitted' };

    const closed = await this.dependencies.repository.transaction(
      async (executor) => {
        const moved = await this.dependencies.repository.requestAccountDeletion(
          executor,
          {
            expectedStatus: current,
            now,
            userId: account.id,
          },
        );
        if (moved === undefined) return undefined;
        // In the same transaction as the transition, because both are USERS'
        // own rows and an availability window left open on a closed account is
        // a window the matcher would read.
        await this.dependencies.availability.close({
          executor,
          now,
          userId: account.id,
        });
        // LIVE's published enforcement contract, taken here because a person on
        // camera when they close their account should not stay on camera. It is
        // LIVE's own code writing LIVE's own rows; this domain never touches
        // them.
        await this.dependencies.live?.endLiveEncountersForSubject({
          executor,
          now,
          userId: account.id,
        });
        // REALTIME's own contract, in the same transaction. Two calls because
        // they are two rows owned by two domains, and ending only the encounter
        // would leave a camera connected to a room the account no longer
        // exists for. It also advances the call's authorization generation, so
        // a join credential the client is already holding dies at the same
        // instant.
        await this.dependencies.calls?.endLiveCallsForSubject({
          executor,
          now,
          userId: account.id,
        });
        return moved;
      },
    );

    if (closed === undefined) {
      // The compare-and-set lost, so something moved the account underneath
      // this. Re-read and answer with what is actually true rather than with
      // what was intended.
      const latest = await this.dependencies.repository.findById(
        this.dependencies.repository.transactionless,
        account.id,
      );
      if (latest === undefined || !isClosing(latest.status)) {
        return { kind: 'not_permitted' };
      }
      return {
        kind: 'closed',
        view: {
          requestedAt: latest.deletionRequestedAt ?? latest.statusChangedAt,
          status: latest.status,
        },
      };
    }

    // Outside the transaction, because both reach domains with their own
    // handles and neither is a rule the account state depends on: the account
    // is already closed and already refused everywhere by the time these run.
    await this.dependencies.authority.revokeAllAuthority({
      accountId: account.authAccountId,
      correlationId: input.correlationId,
    });
    const retired = await this.dependencies.destinations.retireDevices(
      account.id,
    );
    // GROWTH's own rows, on the same terms: outside the transaction, through a
    // published contract, and not a rule the account state depends on.
    const withdrawn =
      (await this.dependencies.invitations?.withdrawInvitesFor(account.id)) ??
      0;

    // An operational signal and deliberately not an identifier: how many
    // closures happen and how many devices they retire is worth watching, and
    // who closed is not something a log line needs to carry.
    this.dependencies.logger.info(
      { devicesRetired: retired, invitationsWithdrawn: withdrawn },
      'users.account.closed',
    );

    return {
      kind: 'closed',
      view: {
        requestedAt: closed.deletionRequestedAt ?? now,
        // The transition wrote it, so this is what the row now says. Read from
        // the returned row rather than assumed, because the returned row is
        // the only account of what actually committed.
        status: isClosing(closed.status) ? closed.status : 'deletion_pending',
      },
    };
  }

  /** Whether a closure has been requested, and when. */
  status(account: UserAccountRow): AccountClosureStatusOutcome {
    if (!isClosing(account.status)) return { kind: 'open' };
    return {
      kind: 'closing',
      view: {
        requestedAt: account.deletionRequestedAt ?? account.statusChangedAt,
        status: account.status,
      },
    };
  }
}
