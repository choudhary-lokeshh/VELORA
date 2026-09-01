import type { SafeLogger } from '@velora/observability/server';

import {
  isTerminalRtcSessionState,
  maximumRtcObligationAttempts,
  rtcObligationBackoffMilliseconds,
  rtcObligationBatchSize,
  rtcObligationDrainIntervalMilliseconds,
  rtcObligationLeaseMilliseconds,
} from './policy.js';

/**
 * How long a not-yet-owed obligation waits before being looked at again.
 *
 * One drain interval: the row is put back exactly where it would have been had
 * the cycle never claimed it, so a call that ends a moment later is torn down
 * on the next pass rather than on a schedule of its own.
 */
const rtcObligationRetryDelay = rtcObligationDrainIntervalMilliseconds;
import type { RtcProviderPort } from './provider.js';
import type { RtcProviderObligationRow, RtcRepository } from './repository.js';

/**
 * What one drain cycle did.
 *
 * Counts only. An operator needs to know how much the platform owes a provider
 * and whether that number is falling; naming the calls would put two people's
 * conversation in a log line, and this domain writes none anywhere else.
 */
export interface RtcReconciliationReport {
  /** Gave up on, loudly. The row stays and the divergence becomes visible. */
  readonly abandoned: number;
  readonly discharged: number;
  readonly examined: number;
  /** Failed this cycle and will be tried again. */
  readonly deferred: number;
  /**
   * Not owed yet, and put back without spending an attempt.
   *
   * A teardown obligation is written the instant a call has a room, so that a
   * crash between ending a call and recording the debt cannot leak one. It is
   * therefore *pending for the whole life of the call*, and discharging it
   * while the call is running would end the call — which is exactly what
   * happened the first time a provider that carries media was pointed at this.
   * With the in-process fixture it was invisible: the worker holds its own
   * instance whose map is empty, so every one of these failed harmlessly.
   */
  readonly postponed: number;
}

/**
 * Discharging what the platform owes a provider.
 *
 * Everything here follows from one rule that ADR-0019 makes and this domain
 * cannot bend: **no provider call runs inside a database transaction.** A
 * pooled connection held across somebody else's network is a connection the
 * admission bound cannot account for, and a slow vendor would become a database
 * outage. So a cycle is a claim, then network calls holding nothing, then a
 * settle — three short transactions with the slow part outside all of them.
 *
 * The claim takes a lease with `skip locked`, so two workers draining at once
 * take disjoint work rather than both tearing down the same room. A worker
 * dying mid-discharge is recoverable because the row stays `pending` and its
 * lease expires; the cost of an early expiry is a duplicate request to a
 * provider that already did the thing, which every operation here is safe
 * against.
 *
 * **Failure is deferral, not deletion.** An obligation that will not discharge
 * backs off and is eventually abandoned — and abandoned is a state the row
 * keeps, because a room this platform could not tear down is exactly what an
 * operator has to see. A row quietly removed after eight tries would be a leak
 * with no evidence of itself.
 *
 * What this never does is decide anything about a call. It carries out
 * decisions already made and recorded: it cannot end a call, cannot revoke
 * authorization, and cannot move a session's state. A reconciler that could
 * would be a second, unreviewed authority over calling.
 */
export class RtcReconciler {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly owner: string;
      readonly provider: RtcProviderPort;
      readonly repository: RtcRepository;
    },
  ) {}

  async dischargeOnce(
    limit = rtcObligationBatchSize,
  ): Promise<RtcReconciliationReport> {
    if (this.dependencies.provider.provider === 'unavailable') {
      // Nothing is owed to a provider that does not exist. Claiming work here
      // would take a lease nobody could discharge and hold it until it expired.
      return {
        abandoned: 0,
        deferred: 0,
        discharged: 0,
        examined: 0,
        postponed: 0,
      };
    }

    const claimed = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.claimDueObligations(executor, {
        leaseMilliseconds: rtcObligationLeaseMilliseconds,
        limit,
        now: this.dependencies.now(),
        owner: this.dependencies.owner,
      }),
    );

    let abandoned = 0;
    let deferred = 0;
    let discharged = 0;
    let postponed = 0;
    for (const obligation of claimed) {
      // Nothing is owed about a call that is still happening.
      //
      // The teardown obligation exists from the moment the call has a room, so
      // that a crash between ending a call and recording the debt cannot leak
      // one. That makes it pending for the call's whole life, and a reconciler
      // that discharged it on its next cycle would end every call five seconds
      // in. Postponed rather than deferred, because nothing failed and an
      // attempt spent here would abandon a perfectly good obligation after
      // eight cycles of an ordinary conversation.
      if (await this.stillRunning(obligation)) {
        const at = this.dependencies.now();
        await this.dependencies.repository.transaction((executor) =>
          this.dependencies.repository.postponeObligation(executor, {
            availableAt: new Date(at.getTime() + rtcObligationRetryDelay),
            id: obligation.id,
            now: at,
          }),
        );
        postponed += 1;
        continue;
      }
      // Outside every transaction, deliberately, and one at a time: a provider
      // asked twenty things at once is a provider that rate-limits the
      // twenty-first, and the batch is already bounded.
      const outcome = await this.attempt(obligation);
      const now = this.dependencies.now();
      if (outcome === undefined) {
        await this.dependencies.repository.transaction((executor) =>
          this.dependencies.repository.settleObligation(executor, {
            discharged: true,
            id: obligation.id,
            now,
          }),
        );
        discharged += 1;
        continue;
      }

      const attempts = obligation.attempts + 1;
      const terminal = attempts >= maximumRtcObligationAttempts;
      await this.dependencies.repository.transaction((executor) =>
        this.dependencies.repository.deferObligation(executor, {
          availableAt: new Date(
            now.getTime() + rtcObligationBackoffMilliseconds(attempts),
          ),
          id: obligation.id,
          now,
          reason: outcome,
          terminal,
        }),
      );
      if (terminal) {
        abandoned += 1;
        // Loud, because this is the divergence: the platform ended a call and
        // a provider may still be holding the room. No identifier of the call
        // or of anybody in it — the kind and the provider are what an operator
        // acts on, and the row carries the rest for whoever opens it.
        this.dependencies.logger.error(
          {
            attempts,
            kind: obligation.kind,
            provider: obligation.provider,
            reason: outcome,
          },
          'rtc provider obligation abandoned',
        );
      } else {
        deferred += 1;
      }
    }

    return {
      abandoned,
      deferred,
      discharged,
      examined: claimed.length,
      postponed,
    };
  }

  /**
   * Whether this obligation is about a call that has not finished.
   *
   * Only teardown is held back. A revocation is about one participant the
   * platform has already decided to remove, and it is owed the instant it is
   * recorded — holding it would be the platform deciding somebody may stay.
   *
   * A session that cannot be read at all is treated as finished: the row
   * outlives nothing, and refusing to ever discharge an obligation whose
   * session is gone would leak the room it names.
   */
  private async stillRunning(
    obligation: RtcProviderObligationRow,
  ): Promise<boolean> {
    if (obligation.kind !== 'terminate_session') return false;
    const found = await this.dependencies.repository.findById(
      this.dependencies.repository.transactionless,
      obligation.sessionId,
    );
    if (found === undefined) return false;
    return !isTerminalRtcSessionState(found.session.state);
  }

  /**
   * Carries out one obligation, returning nothing on success and the reason on
   * failure.
   *
   * A reason rather than a thrown error, because failing to discharge is an
   * ordinary outcome that has to be recorded on the row — and because the
   * message is written to a column an operator reads, so it must be this
   * domain's own words rather than whatever a vendor's client threw.
   */
  private async attempt(
    obligation: RtcProviderObligationRow,
  ): Promise<string | undefined> {
    try {
      switch (obligation.kind) {
        case 'terminate_session': {
          await this.dependencies.provider.endSession(
            obligation.providerReference,
          );
          return undefined;
        }
        case 'revoke_participant': {
          if (obligation.participantReference === null) {
            // Unreachable: the schema's participant-shape check refuses a
            // revocation that names nobody, so this state cannot be stored.
            // The branch exists because the column is nullable for the other
            // obligation kinds, and returning a reason rather than throwing
            // keeps an impossible row from taking down a whole drain cycle.
            return 'revocation names no participant';
          }
          await this.dependencies.provider.revokeParticipant({
            participantReference: obligation.participantReference,
            providerReference: obligation.providerReference,
          });
          return undefined;
        }
        default: {
          // `create_session` is not discharged here. Creation is the
          // orchestrator's two-transaction path, and a reconciler that created
          // rooms would be making calls happen rather than cleaning up after
          // ones that did.
          return `unsupported obligation kind: ${obligation.kind}`;
        }
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'provider call failed';
    }
  }
}
