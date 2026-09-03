import {
  availabilityResponseSchema,
  maximumAvailabilityWindowMilliseconds,
  productErrorCodes,
  saveAvailabilityRequestSchema,
  type AvailabilityState,
} from '@velora/validation';
import { eq, sql } from 'drizzle-orm';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from './context.js';
import type { OnboardingService } from './onboarding.js';
import type {
  UsersDatabase,
  UsersExecutor,
  UserAccountRow,
} from './repository.js';
import { userAvailability } from './schema.js';

type AnyExecutor = UsersDatabase | UsersExecutor;

export type UserAvailabilityRow = typeof userAvailability.$inferSelect;

/**
 * Availability, owned by USERS.
 *
 * It is a bounded, user-managed preference and nothing more. It is not presence,
 * which belongs to REALTIME and does not exist yet; it is not consent to be
 * contacted; it is not a promise of appearing in discovery; and it never
 * overrides a block or an enforcement decision. Discovery reads it as one
 * condition among many and rechecks everything else at action time.
 *
 * PostgreSQL is the only truth here. A Redis projection would be a reasonable
 * read accelerator later, but adding one now would buy an invalidation problem
 * and a second place for availability to be wrong, in exchange for a saving
 * nothing has measured.
 */

/** Availability as the platform acts on it, with an expired window resolved. */
export interface AvailabilityView {
  readonly availableUntil: Date | undefined;
  readonly effectiveState: AvailabilityState;
  readonly revision: number;
  readonly state: AvailabilityState;
  readonly updatedAt: Date;
}

export type AvailabilityOutcome =
  | { readonly kind: 'saved'; readonly view: AvailabilityView }
  | { readonly kind: 'not_eligible' }
  /** The requested window is longer than policy allows, or already past. */
  | { readonly kind: 'window_rejected' };

export class AvailabilityRepository {
  constructor(private readonly database: UsersDatabase) {}

  get transactionless(): UsersDatabase {
    return this.database;
  }

  async find(
    executor: AnyExecutor,
    userId: string,
  ): Promise<UserAvailabilityRow | undefined> {
    const rows = await executor
      .select()
      .from(userAvailability)
      .where(eq(userAvailability.userId, userId))
      .limit(1);
    return rows[0];
  }

  /**
   * Last write wins, resolved by PostgreSQL rather than by the clients.
   *
   * Two devices flipping the same switch at the same instant have no correct
   * winner to pick, so the row is upserted unconditionally and the revision
   * counter advances. Both devices then read the same state, which is the
   * property that actually matters; reporting a conflict here would only ask a
   * person to re-answer a question they already answered.
   *
   * The session start is the one field that deliberately does not follow last
   * write wins. It advances only when a closed availability opens again, so
   * extending a window, or repeating the same answer from a second device, does
   * not move the person through everybody else's discovery results. The decision
   * is made inside the statement rather than from a prior read, so two
   * simultaneous writers cannot each conclude they are starting a new session.
   */
  async set(
    executor: AnyExecutor,
    input: {
      readonly availableUntil: Date | null;
      readonly now: Date;
      readonly state: AvailabilityState;
      readonly userId: string;
    },
  ): Promise<UserAvailabilityRow> {
    const rows = await executor
      .insert(userAvailability)
      .values({
        availableSince: input.state === 'available' ? input.now : null,
        availableUntil: input.availableUntil,
        createdAt: input.now,
        revision: 1,
        state: input.state,
        updatedAt: input.now,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        set: {
          availableSince:
            input.state === 'available'
              ? sql`case
                  when ${userAvailability.state} = 'available'
                    and ${userAvailability.availableUntil} > ${input.now}
                    then ${userAvailability.availableSince}
                  else ${input.now}
                end`
              : null,
          availableUntil: input.availableUntil,
          revision: sql`${userAvailability.revision} + 1`,
          state: input.state,
          updatedAt: input.now,
        },
        target: userAvailability.userId,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Availability upsert returned no row');
    }
    return row;
  }

  /**
   * Closes any window this account is holding.
   *
   * For account closure, and deliberately a write rather than a delete: the
   * row is this domain's record that somebody once made themselves available,
   * and discovery reads the *state* rather than the presence of a row. Safe on
   * an account that never had one — the upsert inserts an unavailable row, and
   * an unavailable row is what an absent one already means.
   */
  async close(
    executor: AnyExecutor,
    input: { readonly now: Date; readonly userId: string },
  ): Promise<void> {
    await this.set(executor, {
      availableUntil: null,
      now: input.now,
      state: 'unavailable',
      userId: input.userId,
    });
  }
}

export interface AvailabilityServiceDependencies {
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  readonly repository: AvailabilityRepository;
}

export class AvailabilityService {
  constructor(private readonly dependencies: AvailabilityServiceDependencies) {}

  async read(account: UserAccountRow): Promise<AvailabilityView> {
    const row = await this.dependencies.repository.find(
      this.dependencies.repository.transactionless,
      account.id,
    );
    return viewOf(row, this.dependencies.now());
  }

  async save(
    account: UserAccountRow,
    input: {
      readonly availableUntil: Date | undefined;
      readonly state: AvailabilityState;
    },
  ): Promise<AvailabilityOutcome> {
    if (!(await this.mayChange(account))) return { kind: 'not_eligible' };
    const now = this.dependencies.now();

    if (input.state === 'available') {
      const until = input.availableUntil;
      if (until === undefined) return { kind: 'window_rejected' };
      const span = until.getTime() - now.getTime();
      // A window that is already closed, or longer than policy allows, is
      // refused rather than quietly clamped: a person should know how long they
      // actually said they were around for.
      if (span <= 0 || span > maximumAvailabilityWindowMilliseconds) {
        return { kind: 'window_rejected' };
      }
    }

    const row = await this.dependencies.repository.set(
      this.dependencies.repository.transactionless,
      {
        availableUntil:
          input.state === 'available' ? (input.availableUntil ?? null) : null,
        now,
        state: input.state,
        userId: account.id,
      },
    );
    return { kind: 'saved', view: viewOf(row, now) };
  }

  /**
   * The same gate profile edits use. Availability set before the profile is
   * complete simply has no effect, because discovery requires both, so there is
   * no reason to make the onboarding order any stricter than it already is.
   */
  private async mayChange(account: UserAccountRow): Promise<boolean> {
    if (account.status !== 'pending_profile' && account.status !== 'active') {
      return false;
    }
    const eligibility = await this.dependencies.onboarding.evaluate(account);
    return eligibility.step === 'profile' || eligibility.step === 'completed';
  }
}

/**
 * Expiry is applied on read rather than written back.
 *
 * A window closing is the passage of time, not an event: nothing happened that
 * anybody should have to record, and a job that rewrote rows at expiry would be
 * a second writer racing the person who owns them.
 */
function viewOf(
  row: UserAvailabilityRow | undefined,
  now: Date,
): AvailabilityView {
  if (row === undefined) {
    return {
      availableUntil: undefined,
      effectiveState: 'unavailable',
      revision: 0,
      state: 'unavailable',
      updatedAt: now,
    };
  }
  const open =
    row.state === 'available' &&
    row.availableUntil !== null &&
    row.availableUntil.getTime() > now.getTime();
  return {
    availableUntil: row.availableUntil ?? undefined,
    effectiveState: open ? 'available' : 'unavailable',
    revision: row.revision,
    state: row.state,
    updatedAt: row.updatedAt,
  };
}

export interface AvailabilityRoutesDependencies {
  readonly availability: AvailabilityService;
  readonly consumerContext: ConsumerContextResolver;
}

export class AvailabilityRoutes {
  constructor(private readonly dependencies: AvailabilityRoutesDependencies) {}

  async getAvailability(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const view = await this.dependencies.availability.read(
      resolved.context.account,
    );
    return { body: availabilityBody(view), status: 200 };
  }

  async saveAvailability(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveAvailabilityRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.availability.save(
      resolved.context.account,
      {
        availableUntil:
          parsed.value.availableUntil === undefined
            ? undefined
            : new Date(parsed.value.availableUntil),
        state: parsed.value.state,
      },
    );
    if (outcome.kind === 'window_rejected') {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    if (outcome.kind !== 'saved') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return { body: availabilityBody(outcome.view), status: 200 };
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

export function availabilityBody(
  view: AvailabilityView,
): ReturnType<typeof availabilityResponseSchema.parse> {
  return availabilityResponseSchema.parse({
    ...(view.availableUntil === undefined
      ? {}
      : { availableUntil: view.availableUntil.toISOString() }),
    effectiveState: view.effectiveState,
    state: view.state,
    updatedAt: view.updatedAt.toISOString(),
  });
}
