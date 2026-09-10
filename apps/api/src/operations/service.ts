import { timingSafeEqual } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import type { CachedControlReader } from './controls.js';
import { readAllControls } from './controls.js';
import type {
  OperatorActionRow,
  OperatorGrantRow,
  OperationsRepository,
} from './repository.js';
import {
  capabilitiesOfRole,
  controlCacheMilliseconds,
  controlDefault,
  type ControlKey,
  type OperatorActionName,
  type OperatorActionOutcome,
  type OperatorCapability,
  type OperatorRole,
  type OperatorSubjectType,
} from './policy.js';

/**
 * What one operator may do, and where that answer came from.
 *
 * The provenance is part of the answer rather than a detail. An operator whose
 * capabilities came from `bootstrap` is on a machine where the absence of a
 * grant means everything, and the console says so in as many words — because an
 * operator who believes they are testing production permissions on a local
 * database is one deploy away from a genuine surprise.
 */
export interface OperatorStanding {
  readonly capabilities: readonly OperatorCapability[];
  readonly role: OperatorRole | undefined;
  readonly source: 'grant' | 'bootstrap' | 'none';
}

export type ControlOutcome =
  | { readonly kind: 'applied'; readonly control: ControlView }
  | { readonly kind: 'conflict'; readonly control: ControlView };

export interface ControlView {
  readonly changedBy: string | undefined;
  readonly enabled: boolean;
  readonly key: ControlKey;
  readonly reason: string | undefined;
  readonly updatedAt: Date | undefined;
  readonly version: number;
}

export type GrantOutcome =
  | { readonly grant: OperatorGrantRow; readonly kind: 'granted' }
  | { readonly kind: 'revoked'; readonly grant: OperatorGrantRow }
  | { readonly kind: 'unchanged' };

/**
 * OPERATIONS' one service.
 *
 * It answers three questions and performs three commands, and every command
 * writes an audit row whatever its outcome — including the ones that were
 * refused, because an operator who tried to pause live search and was told no
 * is a thing an incident review needs to see.
 *
 * It never optimistically reports success. A control write reports `applied`
 * only after the row it changed came back from the database, and a conflict
 * reports the value that actually stands so the console can show the operator
 * what they were racing rather than an error with no state in it.
 */
export class OperationsService {
  constructor(
    private readonly dependencies: {
      /**
       * Whether an operator with no grant is treated as a super administrator.
       * True only where configuration selected the local-test bootstrap, which
       * staging and production refuse at startup.
       */
      readonly bootstrapOperators: boolean;
      /**
       * The digest of the deployment-time bootstrap secret, when one is
       * configured.
       *
       * A digest rather than the value, so the running process never holds a
       * comparable copy of a secret it only has to recognise. Absent means this
       * deployment has no bootstrap door open at all, which is the correct
       * state for every deployment that already has an operator.
       */
      readonly bootstrapTokenDigest?: string | undefined;
      readonly controls: CachedControlReader;
      readonly identifiers?: () => string;
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly repository: OperationsRepository;
    },
  ) {}

  private identifier(): string {
    return this.dependencies.identifiers?.() ?? crypto.randomUUID();
  }

  /* ----------------------------- Standing ------------------------------ */

  /**
   * What this operator may do.
   *
   * A grant wins over the bootstrap wherever one exists, so a machine
   * configured for local development still honours a deliberately narrow role
   * somebody granted themselves to test one — which is the only way the
   * capability checks are exercisable at all before a deployed environment
   * exists.
   */
  async standingOf(subjectReference: string): Promise<OperatorStanding> {
    const grant =
      await this.dependencies.repository.readLiveGrant(subjectReference);
    if (grant !== undefined) {
      return {
        capabilities: capabilitiesOfRole(grant.role),
        role: grant.role,
        source: 'grant',
      };
    }
    if (this.dependencies.bootstrapOperators) {
      return {
        capabilities: capabilitiesOfRole('super_admin'),
        role: 'super_admin',
        source: 'bootstrap',
      };
    }
    // Fail closed. Being an operator is not a capability; holding one is.
    return { capabilities: [], role: undefined, source: 'none' };
  }

  /* ------------------------------ Controls ----------------------------- */

  /** Every control's current value, including the ones nobody has ever set. */
  async controls(): Promise<readonly ControlView[]> {
    return readAllControls(this.dependencies.repository);
  }

  /** How long a change may take to reach every process. Published, not hidden. */
  get controlPropagationMilliseconds(): number {
    return controlCacheMilliseconds;
  }

  /**
   * Sets one control, but only from the version the operator was looking at.
   *
   * A control nobody has ever set has version zero, so a first write and a
   * subsequent one are the same operation with the same token rather than two
   * paths with two race conditions. Two operators on the same screen resolve
   * deterministically: one applies, the other is told what actually stands.
   */
  async setControl(input: {
    readonly actorReference: string;
    readonly enabled: boolean;
    readonly expectedVersion: number;
    readonly key: ControlKey;
    readonly reason: string;
  }): Promise<ControlOutcome> {
    const now = this.dependencies.now();
    const outcome = await this.dependencies.repository.transaction(
      async (executor) => {
        if (input.expectedVersion === 0) {
          const inserted = await this.dependencies.repository.insertControl(
            executor,
            {
              changedBy: input.actorReference,
              enabled: input.enabled,
              key: input.key,
              now,
              reason: input.reason,
            },
          );
          return inserted;
        }
        return this.dependencies.repository.updateControl(executor, {
          changedBy: input.actorReference,
          enabled: input.enabled,
          expectedVersion: input.expectedVersion,
          key: input.key,
          now,
          reason: input.reason,
        });
      },
    );

    if (outcome === undefined) {
      // Somebody else moved it. Report what stands rather than an error with no
      // state in it, so the console can show the operator what they were racing.
      const current = await this.dependencies.repository.readControl(input.key);
      return {
        control:
          current === undefined
            ? {
                changedBy: undefined,
                enabled: controlDefault(input.key),
                key: input.key,
                reason: undefined,
                updatedAt: undefined,
                version: 0,
              }
            : {
                changedBy: current.changedBy,
                enabled: current.enabled,
                key: current.key,
                reason: current.reason,
                updatedAt: current.updatedAt,
                version: current.version,
              },
        kind: 'conflict',
      };
    }

    // This process stops believing what it believed a moment ago. Every other
    // process waits out its own window, which is why the bound is published.
    this.dependencies.controls.forget(input.key);
    return {
      control: {
        changedBy: outcome.changedBy,
        enabled: outcome.enabled,
        key: outcome.key,
        reason: outcome.reason,
        updatedAt: outcome.updatedAt,
        version: outcome.version,
      },
      kind: 'applied',
    };
  }

  /* ------------------------------- Grants ------------------------------ */

  /**
   * The role one operator was actually granted, if any.
   *
   * Distinct from `standingOf`, which answers what they may do — and which
   * reports `super_admin` on a machine running the local-test bootstrap even
   * for somebody holding nothing. An audit row recording that as the previous
   * state would be recording a grant that never existed.
   */
  async grantedRoleOf(
    subjectReference: string,
  ): Promise<OperatorRole | undefined> {
    const grant =
      await this.dependencies.repository.readLiveGrant(subjectReference);
    return grant?.role;
  }

  async grants(input: {
    readonly cursor?: { readonly grantedAt: Date; readonly id: string };
    readonly limit: number;
  }): Promise<readonly OperatorGrantRow[]> {
    return this.dependencies.repository.listGrants(input);
  }

  /**
   * Gives one operator a role, replacing whatever they held.
   *
   * A replacement rather than an addition, and it is done in one transaction:
   * the old grant is revoked and the new one written together, so there is no
   * instant in which the operator holds two roles and no instant in which they
   * hold none. The unique index would refuse the second grant anyway; doing it
   * in order means the refusal never happens.
   */
  async grantRole(input: {
    readonly actorReference: string;
    readonly reason: string;
    readonly role: OperatorRole;
    readonly subjectReference: string;
  }): Promise<GrantOutcome> {
    const now = this.dependencies.now();
    const id = this.identifier();
    const grant = await this.dependencies.repository.transaction(
      async (executor) => {
        await this.dependencies.repository.revokeGrant(executor, {
          now,
          revokedBy: input.actorReference,
          subjectReference: input.subjectReference,
        });
        return this.dependencies.repository.insertGrant(executor, {
          grantedBy: input.actorReference,
          id,
          now,
          reason: input.reason,
          role: input.role,
          subjectReference: input.subjectReference,
        });
      },
    );
    if (grant === undefined) return { kind: 'unchanged' };
    return { grant, kind: 'granted' };
  }

  /**
   * The first operator grant in a deployed environment.
   *
   * A deployment where nobody holds a grant has nobody who can issue one, and
   * this is the only way out of that. Three independent things have to be true,
   * and the caller supplies only one of them:
   *
   * - the caller already holds a Platform Admin session at phishing-resistant
   *   assurance, which the route establishes before calling this at all;
   * - the deployment-time secret matches, which proves whoever is asking also
   *   deployed this environment;
   * - and no grant exists yet, checked inside the transaction that writes one.
   *
   * The exactly-once property is the database's. `singleton` is uniquely
   * indexed, so two concurrent attempts cannot both insert, and the row is
   * never removed — which is what makes a replay after a restart fail the same
   * way a replay a second later does.
   *
   * Every refusal answers the same way. Whether the secret was wrong, the door
   * is closed, or somebody already came through is not something a caller
   * learns from here.
   */
  async bootstrapFirstOperator(input: {
    readonly correlationId?: string | undefined;
    readonly presentedTokenDigest: string;
    readonly reason: string;
    readonly subjectReference: string;
  }): Promise<GrantOutcome> {
    const expected = this.dependencies.bootstrapTokenDigest;
    const matched =
      expected?.length === input.presentedTokenDigest.length &&
      timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(input.presentedTokenDigest, 'utf8'),
      );
    if (!matched) {
      await this.recordAction({
        action: 'operator.role.granted',
        actorReference: input.subjectReference,
        capability: 'operators.manage',
        correlationId: input.correlationId,
        failureCode: 'bootstrap_refused',
        outcome: 'refused',
        reason: input.reason,
        requestedState: 'super_admin',
        subjectId: input.subjectReference,
        subjectType: 'operator',
      });
      return { kind: 'unchanged' };
    }

    const now = this.dependencies.now();
    const grantId = this.identifier();
    const bootstrapId = this.identifier();
    const grant = await this.dependencies.repository.transaction(
      async (executor) => {
        if (
          (await this.dependencies.repository.countLiveGrants(executor)) > 0
        ) {
          return undefined;
        }
        const claimed = await this.dependencies.repository.claimBootstrap(
          executor,
          {
            grantId,
            id: bootstrapId,
            now,
            subjectReference: input.subjectReference,
            tokenDigest: input.presentedTokenDigest,
          },
        );
        if (!claimed) return undefined;
        return this.dependencies.repository.insertGrant(executor, {
          // Deliberately nobody. The first grant has no granting operator by
          // definition, and naming the subject here would record them granting
          // themselves an authority they did not yet hold.
          grantedBy: undefined,
          id: grantId,
          now,
          reason: input.reason,
          role: 'super_admin',
          subjectReference: input.subjectReference,
        });
      },
    );

    await this.recordAction({
      action: 'operator.role.granted',
      actorReference: input.subjectReference,
      capability: 'operators.manage',
      correlationId: input.correlationId,
      ...(grant === undefined ? { failureCode: 'bootstrap_refused' } : {}),
      outcome: grant === undefined ? 'refused' : 'applied',
      reason: input.reason,
      requestedState: 'super_admin',
      subjectId: input.subjectReference,
      subjectType: 'operator',
    });
    if (grant === undefined) return { kind: 'unchanged' };
    return { grant, kind: 'granted' };
  }

  /** Whether the one bootstrap this deployment has has already been taken. */
  async bootstrapConsumed(): Promise<boolean> {
    return this.dependencies.repository.bootstrapConsumed();
  }

  /** Ends one operator's role. Repeating it is safe and changes nothing. */
  async revokeRole(input: {
    readonly actorReference: string;
    readonly subjectReference: string;
  }): Promise<GrantOutcome> {
    const now = this.dependencies.now();
    const grant = await this.dependencies.repository.transaction((executor) =>
      this.dependencies.repository.revokeGrant(executor, {
        now,
        revokedBy: input.actorReference,
        subjectReference: input.subjectReference,
      }),
    );
    if (grant === undefined) return { kind: 'unchanged' };
    return { grant, kind: 'revoked' };
  }

  /* ------------------------------- Audit ------------------------------- */

  /**
   * Records what an operator did, whatever happened.
   *
   * Never inside the command's transaction. An audit row that rolled back with
   * a failed command would leave no trace of the attempt, which is the one
   * thing an audit exists to prevent — and a refusal has no transaction to join.
   *
   * A failure to write the audit row is logged and swallowed rather than
   * propagated. That is a deliberate and uncomfortable choice: it means a
   * command can succeed with no record. The alternative is worse in both
   * directions — a state-changing command that already committed cannot be
   * un-done by a later insert failing, and turning it into a 500 would tell the
   * operator the change did not happen when it did.
   */
  async recordAction(input: {
    readonly action: OperatorActionName;
    readonly actorReference: string;
    readonly capability: OperatorCapability;
    readonly correlationId?: string | undefined;
    readonly failureCode?: string | undefined;
    readonly outcome: OperatorActionOutcome;
    readonly previousState?: string | undefined;
    readonly reason: string;
    readonly requestedState?: string | undefined;
    readonly subjectId?: string | undefined;
    readonly subjectType: OperatorSubjectType;
  }): Promise<void> {
    try {
      await this.dependencies.repository.insertAction({
        action: input.action,
        actorReference: input.actorReference,
        capability: input.capability,
        correlationId: input.correlationId,
        failureCode: input.failureCode,
        id: this.identifier(),
        now: this.dependencies.now(),
        outcome: input.outcome,
        previousState: input.previousState,
        reason: input.reason,
        requestedState: input.requestedState,
        subjectId: input.subjectId,
        subjectType: input.subjectType,
      });
    } catch (error) {
      this.dependencies.logger.error(
        {
          action: input.action,
          err: error,
          outcome: input.outcome,
          subjectType: input.subjectType,
        },
        'operator action was not recorded',
      );
    }
  }

  async actions(input: {
    readonly action?: OperatorActionName;
    readonly actorReference?: string;
    readonly cursor?: { readonly id: string; readonly occurredAt: Date };
    readonly limit: number;
    readonly outcome?: OperatorActionOutcome;
    readonly since: Date;
    readonly subjectId?: string;
  }): Promise<readonly OperatorActionRow[]> {
    return this.dependencies.repository.listActions(input);
  }
}
