import { and, count, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { authSecurityEvents } from '../auth/schema.js';
import type { PaymentState } from '../billing/payment-policy.js';
import {
  billingDisputes,
  billingOffers,
  billingPayments,
  billingRefunds,
} from '../billing/schema.js';
import { clubMemberships, clubs } from '../clubs/schema.js';
import { decodeCatalogCursor, encodeCatalogCursor } from '../clubs/cursor.js';
import { creatorAccounts, creatorProfiles } from '../creators/schema.js';
import { bounded } from '../database/fan-out.js';
import type { DatabaseHandle } from '../database/executor.js';
import type { PayoutInstructionState } from '../payouts/policy.js';
import { payoutsInstructions } from '../payouts/schema.js';
import { openAppealStates, openCaseStates } from '../safety/policy.js';
import {
  safetyAppeals,
  safetyCases,
  safetyDecisions,
} from '../safety/schema.js';
import { userAccounts } from '../users/schema.js';

/**
 * The reads an operations team works from.
 *
 * ADMIN owns no table, and this changes none: every statement here is a select.
 * It sits beside `AdminFinancialDirectory`, which established the pattern — an
 * operator read model that queries the owning domain's schema rather than
 * inventing a projection nobody maintains — and it holds to the same two rules
 * that directory does.
 *
 * **Nothing here publishes a person.** A payment carries no payer, a payout no
 * recipient, a membership no member, a security event no account. Each omission
 * is deliberate and each is load-bearing: a console that could answer "what has
 * this person bought" or "who is in this club" is a browsing surface over
 * private material, whatever the screen around it is called.
 *
 * **Nothing here derives a figure.** Every number is a count or a per-currency
 * total the database computed. There is no rate, no trend, and no ratio, on the
 * surface where somebody would act on one.
 */

/** Statuses that mean an account is not simply getting on with it. */
const accountsNeedingAttention = [
  'restricted',
  'deletion_pending',
  'deactivated',
  'erased',
] as const;

const maximumOperationalPageSize = 50;

function boundedSize(pageSize: number): number {
  return Math.min(pageSize, maximumOperationalPageSize);
}

/* ============================== Overview ============================= */

export interface OperationalCount {
  readonly count: number;
  readonly state: string;
}

export interface AdminAttention {
  readonly accountsRestricted: number;
  readonly appealsAwaiting: number;
  readonly casesOpen: number;
  readonly casesUnclaimed: number;
  readonly creatorsSuspended: number;
  readonly disputesOpen: number;
  readonly financialRecordsNeedingPerson: number;
  readonly payoutsAwaitingConfirmation: number;
}

export interface AdminOverview {
  readonly attention: AdminAttention;
  readonly casesByPriority: readonly OperationalCount[];
  readonly casesByQueue: readonly OperationalCount[];
  readonly observedAt: Date;
  readonly oldestOpenCaseAt: Date | undefined;
}

/* ============================== Accounts ============================= */

export interface AdminAccountRow {
  readonly createdAt: Date;
  readonly deletionRequestedAt: Date | null;
  readonly id: string;
  readonly region: string | null;
  readonly status: string;
  readonly statusChangedAt: Date;
  readonly statusReason: string | null;
}

export interface AdminAccountPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminAccountRow[];
  readonly statusCounts: readonly OperationalCount[];
}

/* ============================== Payments ============================= */

export interface AdminPaymentRow {
  readonly amountMinor: bigint;
  readonly createdAt: Date;
  readonly currency: string;
  readonly failureReason: string | null;
  readonly id: string;
  readonly lastProviderSyncAt: Date | null;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly resourceType: string | null;
  readonly state: string;
  readonly taxMinor: bigint | null;
  readonly updatedAt: Date;
}

export interface AdminPaymentPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminPaymentRow[];
}

export interface AdminRefundRow {
  readonly amountMinor: bigint;
  readonly createdAt: Date;
  readonly currency: string;
  readonly failureReason: string | null;
  readonly id: string;
  readonly paymentId: string;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly reasonCode: string;
  readonly state: string;
  readonly updatedAt: Date;
}

export interface AdminDisputeRow {
  readonly amountMinor: bigint;
  readonly createdAt: Date;
  readonly currency: string;
  readonly evidenceDueAt: Date | null;
  readonly id: string;
  readonly openedAt: Date;
  readonly paymentId: string;
  readonly providerReference: string;
  readonly reasonCode: string;
  readonly resolvedAt: Date | null;
  readonly state: string;
}

export interface AdminPaymentDetail {
  readonly disputes: readonly AdminDisputeRow[];
  readonly payment: AdminPaymentRow;
  readonly refunds: readonly AdminRefundRow[];
}

/* =============================== Payouts ============================= */

export interface AdminPayoutRow {
  readonly amountMinor: bigint;
  readonly createdAt: Date;
  readonly creatorId: string;
  readonly currency: string;
  readonly failureReason: string | null;
  readonly id: string;
  readonly lastProviderSyncAt: Date | null;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly requestedBy: string;
  readonly state: string;
  readonly updatedAt: Date;
}

export interface AdminPayoutPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminPayoutRow[];
}

/* ================================ Clubs ============================== */

export interface AdminClubRow {
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly creatorId: string;
  readonly handle: string | undefined;
  readonly id: string;
  readonly lifecycle: string;
  readonly memberships: readonly OperationalCount[];
  readonly name: string;
  readonly publishedAt: Date | null;
  readonly slug: string;
}

export interface AdminClubMembershipRow {
  readonly grantedAt: Date;
  readonly id: string;
  readonly revokedAt: Date | null;
  readonly source: string;
  readonly state: string;
}

export interface AdminClubPage {
  readonly memberships: readonly AdminClubMembershipRow[] | undefined;
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminClubRow[];
}

/* ================================ Audit ============================== */

export type AdminAuditStream = 'security' | 'decision';

export interface AdminAuditRow {
  readonly actorReference: string | undefined;
  readonly audience: string | undefined;
  readonly correlationId: string | undefined;
  readonly id: string;
  readonly occurredAt: Date;
  readonly outcome: string | undefined;
  readonly stream: AdminAuditStream;
  readonly subjectType: string | undefined;
  readonly what: string;
}

export interface AdminAuditPage {
  readonly nextCursor: string | undefined;
  readonly rows: readonly AdminAuditRow[];
  readonly stream: AdminAuditStream;
}

/**
 * A position in AUTH's security log.
 *
 * Its own encoding rather than the catalog cursor, because that table's key is
 * a bigserial and the catalog cursor refuses anything that is not a UUID. Both
 * are keyset positions over an instant that is written once, which is what
 * stops a page boundary moving under a reader.
 */
function encodeSequenceCursor(input: {
  readonly id: number;
  readonly moment: Date;
}): string {
  return Buffer.from(
    JSON.stringify({ n: input.id, t: input.moment.toISOString() }),
    'utf8',
  ).toString('base64url');
}

function decodeSequenceCursor(
  value: string,
): { readonly id: number; readonly moment: Date } | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { n: id, t: moment } = decoded as {
    readonly n?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return undefined;
  if (typeof moment !== 'string') return undefined;
  const instant = new Date(moment);
  if (Number.isNaN(instant.getTime())) return undefined;
  return { id, moment: instant };
}

export class AdminOperationsDirectory {
  constructor(
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly now: () => Date;
    },
  ) {}

  private get database(): DatabaseHandle {
    return this.dependencies.database;
  }

  /**
   * What is waiting for somebody, over whole tables.
   *
   * Eleven reads, a few at a time rather than one at a time or all at once.
   * Each is a count or a grouped count; none of them reads a row of content.
   *
   * All eleven used to be issued together, which is more connections than
   * ADR-0019 sizes the whole pool at — and it held while this was the only
   * screen doing it. It stopped holding the moment a second operator read ran
   * beside it: what surfaced was not a slow screen but a driver returning one
   * query's rows for another, which the response schema caught as a `Date`
   * where a state belonged. `bounded` is the fix and is applied to every
   * operator read on this surface. See `../database/fan-out.ts`.
   */
  async overview(): Promise<AdminOverview> {
    const [
      casesOpen,
      casesUnclaimed,
      appealsAwaiting,
      creatorsSuspended,
      accountsRestricted,
      disputesOpen,
      payoutsAwaitingConfirmation,
      financialRecordsNeedingPerson,
      casesByQueue,
      casesByPriority,
      oldest,
    ] = await bounded([
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(safetyCases)
            .where(inArray(safetyCases.state, [...openCaseStates])),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(safetyCases)
            .where(
              and(
                inArray(safetyCases.state, [...openCaseStates]),
                isNull(safetyCases.assignedActorReference),
              ),
            ),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(safetyAppeals)
            .where(inArray(safetyAppeals.state, [...openAppealStates])),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(creatorAccounts)
            .where(eq(creatorAccounts.status, 'suspended')),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(userAccounts)
            .where(eq(userAccounts.status, 'restricted')),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(billingDisputes)
            .where(inArray(billingDisputes.state, ['opened', 'under_review'])),
        ),
      async () =>
        this.countOf(
          this.database
            .select({ total: count() })
            .from(payoutsInstructions)
            .where(eq(payoutsInstructions.state, 'submitted')),
        ),
      async () => this.reconciliationCount(),
      async () => this.groupedCount(safetyCases.queue),
      async () => this.groupedCount(safetyCases.priority),
      async () =>
        this.database
          .select({ openedAt: safetyCases.openedAt })
          .from(safetyCases)
          .where(inArray(safetyCases.state, [...openCaseStates]))
          .orderBy(safetyCases.openedAt)
          .limit(1),
    ]);

    return {
      attention: {
        accountsRestricted,
        appealsAwaiting,
        casesOpen,
        casesUnclaimed,
        creatorsSuspended,
        disputesOpen,
        financialRecordsNeedingPerson,
        payoutsAwaitingConfirmation,
      },
      casesByPriority,
      casesByQueue,
      observedAt: this.dependencies.now(),
      oldestOpenCaseAt: oldest[0]?.openedAt,
    };
  }

  /**
   * How many commercial records are waiting on a person.
   *
   * The same three classes `AdminFinancialDirectory` publishes on the money
   * screen — an operation whose provider answer was lost, a reversal in the
   * same position, and a payout awaiting confirmation — counted rather than
   * grouped, so the overview and the money screen cannot disagree.
   */
  private async reconciliationCount(): Promise<number> {
    const [payments, refunds] = await Promise.all([
      this.countOf(
        this.database
          .select({ total: count() })
          .from(billingPayments)
          .where(eq(billingPayments.state, 'reconciliation_pending')),
      ),
      this.countOf(
        this.database
          .select({ total: count() })
          .from(billingRefunds)
          .where(eq(billingRefunds.state, 'reconciliation_pending')),
      ),
    ]);
    return payments + refunds;
  }

  private async countOf(
    query: Promise<readonly { readonly total: number }[]>,
  ): Promise<number> {
    const rows = await query;
    return rows[0]?.total ?? 0;
  }

  private async groupedCount(
    column: typeof safetyCases.priority | typeof safetyCases.queue,
  ): Promise<readonly OperationalCount[]> {
    const rows = await this.database
      .select({ state: column, total: count() })
      .from(safetyCases)
      .where(inArray(safetyCases.state, [...openCaseStates]))
      .groupBy(column)
      .orderBy(column);
    return rows.map((row) => ({ count: row.total, state: row.state }));
  }

  /* ----------------------------- Accounts --------------------------- */

  /**
   * Consumer accounts, and the whole population counted by status.
   *
   * With no status asked for this is the enforcement work list: only accounts
   * the platform has itself decided are not in good standing. That is what
   * keeps it from being a people browser — the rows are bounded by the
   * platform's own decisions rather than by whatever somebody types.
   */
  async accounts(input: {
    readonly accountId: string | undefined;
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly status: string | undefined;
  }): Promise<AdminAccountPage> {
    const size = boundedSize(input.pageSize);
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCatalogCursor(input.cursor);

    const selection = {
      createdAt: userAccounts.createdAt,
      deletionRequestedAt: userAccounts.deletionRequestedAt,
      id: userAccounts.id,
      region: userAccounts.region,
      status: userAccounts.status,
      statusChangedAt: userAccounts.statusChangedAt,
      statusReason: userAccounts.statusReason,
    };

    const [rows, statusCounts] = await Promise.all([
      input.accountId === undefined
        ? this.database
            .select(selection)
            .from(userAccounts)
            .where(
              and(
                input.status === undefined
                  ? inArray(userAccounts.status, [...accountsNeedingAttention])
                  : eq(userAccounts.status, input.status),
                after === undefined
                  ? undefined
                  : or(
                      lt(userAccounts.createdAt, after.moment),
                      and(
                        eq(userAccounts.createdAt, after.moment),
                        lt(userAccounts.id, after.id),
                      ),
                    ),
              ),
            )
            .orderBy(desc(userAccounts.createdAt), desc(userAccounts.id))
            .limit(size + 1)
        : this.database
            .select(selection)
            .from(userAccounts)
            .where(eq(userAccounts.id, input.accountId))
            .limit(1),
      this.database
        .select({ state: userAccounts.status, total: count() })
        .from(userAccounts)
        .groupBy(userAccounts.status)
        .orderBy(userAccounts.status),
    ]);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        input.accountId === undefined &&
        rows.length > size &&
        last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page,
      statusCounts: statusCounts.map((row) => ({
        count: row.total,
        state: row.state,
      })),
    };
  }

  /* ----------------------------- Payments --------------------------- */

  async payments(input: {
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly state: PaymentState | undefined;
  }): Promise<AdminPaymentPage> {
    const size = boundedSize(input.pageSize);
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCatalogCursor(input.cursor);

    // Left-joined rather than joined: an offer that was retired must not make
    // the payment it funded disappear from a finance queue.
    const rows = await this.database
      .select({
        amountMinor: billingPayments.amountMinor,
        createdAt: billingPayments.createdAt,
        currency: billingPayments.currency,
        failureReason: billingPayments.failureReason,
        id: billingPayments.id,
        lastProviderSyncAt: billingPayments.lastProviderSyncAt,
        provider: billingPayments.provider,
        providerReference: billingPayments.providerReference,
        resourceType: billingOffers.resourceType,
        state: billingPayments.state,
        taxMinor: billingPayments.taxMinor,
        updatedAt: billingPayments.updatedAt,
      })
      .from(billingPayments)
      .leftJoin(billingOffers, eq(billingOffers.id, billingPayments.offerId))
      .where(
        and(
          input.state === undefined
            ? undefined
            : eq(billingPayments.state, input.state),
          after === undefined
            ? undefined
            : or(
                lt(billingPayments.createdAt, after.moment),
                and(
                  eq(billingPayments.createdAt, after.moment),
                  lt(billingPayments.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
      .limit(size + 1);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page,
    };
  }

  /** One payment with everything recorded against it, or nothing. */
  async payment(paymentId: string): Promise<AdminPaymentDetail | undefined> {
    const page = await this.database
      .select({
        amountMinor: billingPayments.amountMinor,
        createdAt: billingPayments.createdAt,
        currency: billingPayments.currency,
        failureReason: billingPayments.failureReason,
        id: billingPayments.id,
        lastProviderSyncAt: billingPayments.lastProviderSyncAt,
        provider: billingPayments.provider,
        providerReference: billingPayments.providerReference,
        resourceType: billingOffers.resourceType,
        state: billingPayments.state,
        taxMinor: billingPayments.taxMinor,
        updatedAt: billingPayments.updatedAt,
      })
      .from(billingPayments)
      .leftJoin(billingOffers, eq(billingOffers.id, billingPayments.offerId))
      .where(eq(billingPayments.id, paymentId))
      .limit(1);
    const payment = page[0];
    if (payment === undefined) return undefined;

    const [refunds, disputes] = await Promise.all([
      this.database
        .select({
          amountMinor: billingRefunds.amountMinor,
          createdAt: billingRefunds.createdAt,
          currency: billingRefunds.currency,
          failureReason: billingRefunds.failureReason,
          id: billingRefunds.id,
          paymentId: billingRefunds.paymentId,
          provider: billingRefunds.provider,
          providerReference: billingRefunds.providerReference,
          reasonCode: billingRefunds.reasonCode,
          state: billingRefunds.state,
          updatedAt: billingRefunds.updatedAt,
        })
        .from(billingRefunds)
        .where(eq(billingRefunds.paymentId, paymentId))
        .orderBy(desc(billingRefunds.createdAt))
        .limit(50),
      this.database
        .select({
          amountMinor: billingDisputes.amountMinor,
          createdAt: billingDisputes.createdAt,
          currency: billingDisputes.currency,
          evidenceDueAt: billingDisputes.evidenceDueAt,
          id: billingDisputes.id,
          openedAt: billingDisputes.openedAt,
          paymentId: billingDisputes.paymentId,
          providerReference: billingDisputes.providerReference,
          reasonCode: billingDisputes.reasonCode,
          resolvedAt: billingDisputes.resolvedAt,
          state: billingDisputes.state,
        })
        .from(billingDisputes)
        .where(eq(billingDisputes.paymentId, paymentId))
        .orderBy(desc(billingDisputes.openedAt))
        .limit(50),
    ]);

    return { disputes, payment, refunds };
  }

  /* ------------------------------ Payouts --------------------------- */

  async payouts(input: {
    readonly creatorId: string | undefined;
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly state: PayoutInstructionState | undefined;
  }): Promise<AdminPayoutPage> {
    const size = boundedSize(input.pageSize);
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCatalogCursor(input.cursor);

    const rows = await this.database
      .select({
        amountMinor: payoutsInstructions.amountMinor,
        createdAt: payoutsInstructions.createdAt,
        creatorId: payoutsInstructions.creatorId,
        currency: payoutsInstructions.currency,
        failureReason: payoutsInstructions.failureReason,
        id: payoutsInstructions.id,
        lastProviderSyncAt: payoutsInstructions.lastProviderSyncAt,
        provider: payoutsInstructions.provider,
        providerReference: payoutsInstructions.providerReference,
        requestedBy: payoutsInstructions.requestedBy,
        state: payoutsInstructions.state,
        updatedAt: payoutsInstructions.updatedAt,
      })
      .from(payoutsInstructions)
      .where(
        and(
          input.state === undefined
            ? undefined
            : eq(payoutsInstructions.state, input.state),
          input.creatorId === undefined
            ? undefined
            : eq(payoutsInstructions.creatorId, input.creatorId),
          after === undefined
            ? undefined
            : or(
                lt(payoutsInstructions.createdAt, after.moment),
                and(
                  eq(payoutsInstructions.createdAt, after.moment),
                  lt(payoutsInstructions.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(
        desc(payoutsInstructions.createdAt),
        desc(payoutsInstructions.id),
      )
      .limit(size + 1);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page,
    };
  }

  /* ------------------------------- Clubs ---------------------------- */

  /**
   * Clubs, with the memberships of one of them when one is asked for.
   *
   * The membership counts come from one grouped statement over the page rather
   * than one statement per club: the page is bounded, so this is bounded with
   * it, and a directory that issued a query per row would slow down exactly as
   * the platform grew.
   */
  async clubs(input: {
    readonly clubId: string | undefined;
    readonly creatorId: string | undefined;
    readonly cursor: string | undefined;
    readonly pageSize: number;
  }): Promise<AdminClubPage> {
    const size = boundedSize(input.pageSize);
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCatalogCursor(input.cursor);

    const rows = await this.database
      .select({
        closedAt: clubs.closedAt,
        createdAt: clubs.createdAt,
        creatorId: clubs.creatorId,
        id: clubs.id,
        lifecycle: clubs.lifecycle,
        name: clubs.name,
        publishedAt: clubs.publishedAt,
        slug: clubs.slug,
      })
      .from(clubs)
      .where(
        input.clubId !== undefined
          ? eq(clubs.id, input.clubId)
          : and(
              input.creatorId === undefined
                ? undefined
                : eq(clubs.creatorId, input.creatorId),
              after === undefined
                ? undefined
                : or(
                    lt(clubs.createdAt, after.moment),
                    and(
                      eq(clubs.createdAt, after.moment),
                      lt(clubs.id, after.id),
                    ),
                  ),
            ),
      )
      .orderBy(desc(clubs.createdAt), desc(clubs.id))
      .limit(input.clubId === undefined ? size + 1 : 1);

    const page = rows.slice(0, input.clubId === undefined ? size : 1);
    const identifiers = page.map((row) => row.id);
    const creatorIds = [...new Set(page.map((row) => row.creatorId))];

    const [memberCounts, handles, memberships] = await Promise.all([
      identifiers.length === 0
        ? Promise.resolve([])
        : this.database
            .select({
              clubId: clubMemberships.clubId,
              state: clubMemberships.state,
              total: count(),
            })
            .from(clubMemberships)
            .where(inArray(clubMemberships.clubId, identifiers))
            .groupBy(clubMemberships.clubId, clubMemberships.state)
            .orderBy(clubMemberships.state),
      creatorIds.length === 0
        ? Promise.resolve([])
        : this.database
            .select({
              creatorId: creatorProfiles.creatorId,
              handle: creatorProfiles.handle,
            })
            .from(creatorProfiles)
            .where(inArray(creatorProfiles.creatorId, creatorIds)),
      input.clubId === undefined
        ? Promise.resolve(undefined)
        : this.database
            .select({
              grantedAt: clubMemberships.grantedAt,
              id: clubMemberships.id,
              revokedAt: clubMemberships.revokedAt,
              source: clubMemberships.source,
              state: clubMemberships.state,
            })
            .from(clubMemberships)
            .where(eq(clubMemberships.clubId, input.clubId))
            .orderBy(desc(clubMemberships.grantedAt))
            .limit(50),
    ]);

    const countsByClub = new Map<string, OperationalCount[]>();
    for (const row of memberCounts) {
      const existing = countsByClub.get(row.clubId) ?? [];
      existing.push({ count: row.total, state: row.state });
      countsByClub.set(row.clubId, existing);
    }
    const handleByCreator = new Map(
      handles.map((row) => [row.creatorId, row.handle]),
    );

    const last = page.at(-1);
    return {
      memberships,
      nextCursor:
        input.clubId === undefined && rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page.map((row) => ({
        ...row,
        handle: handleByCreator.get(row.creatorId),
        memberships: countsByClub.get(row.id) ?? [],
      })),
    };
  }

  /* ------------------------------- Audit ---------------------------- */

  async audit(input: {
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly stream: AdminAuditStream;
  }): Promise<AdminAuditPage> {
    return input.stream === 'security'
      ? this.securityAudit(input.cursor, boundedSize(input.pageSize))
      : this.decisionAudit(input.cursor, boundedSize(input.pageSize));
  }

  private async securityAudit(
    cursor: string | undefined,
    size: number,
  ): Promise<AdminAuditPage> {
    const after =
      cursor === undefined ? undefined : decodeSequenceCursor(cursor);
    const rows = await this.database
      .select({
        audience: authSecurityEvents.audience,
        correlationId: authSecurityEvents.correlationId,
        eventType: authSecurityEvents.eventType,
        id: authSecurityEvents.id,
        occurredAt: authSecurityEvents.occurredAt,
        reason: authSecurityEvents.reason,
      })
      .from(authSecurityEvents)
      .where(
        after === undefined
          ? undefined
          : or(
              lt(authSecurityEvents.occurredAt, after.moment),
              and(
                eq(authSecurityEvents.occurredAt, after.moment),
                lt(authSecurityEvents.id, after.id),
              ),
            ),
      )
      .orderBy(desc(authSecurityEvents.occurredAt), desc(authSecurityEvents.id))
      .limit(size + 1);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeSequenceCursor({ id: last.id, moment: last.occurredAt })
          : undefined,
      stream: 'security',
      rows: page.map((row) => ({
        actorReference: undefined,
        audience: row.audience ?? undefined,
        correlationId: row.correlationId,
        id: String(row.id),
        occurredAt: row.occurredAt,
        outcome: row.reason ?? undefined,
        stream: 'security' as const,
        subjectType: undefined,
        what: row.eventType,
      })),
    };
  }

  private async decisionAudit(
    cursor: string | undefined,
    size: number,
  ): Promise<AdminAuditPage> {
    const after =
      cursor === undefined ? undefined : decodeCatalogCursor(cursor);
    const rows = await this.database
      .select({
        action: safetyDecisions.action,
        actorReference: safetyDecisions.actorReference,
        decidedAt: safetyDecisions.decidedAt,
        id: safetyDecisions.id,
        reasonCode: safetyDecisions.reasonCode,
        targetType: safetyDecisions.targetType,
      })
      .from(safetyDecisions)
      .where(
        after === undefined
          ? undefined
          : or(
              lt(safetyDecisions.decidedAt, after.moment),
              and(
                eq(safetyDecisions.decidedAt, after.moment),
                lt(safetyDecisions.id, after.id),
              ),
            ),
      )
      .orderBy(desc(safetyDecisions.decidedAt), desc(safetyDecisions.id))
      .limit(size + 1);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.decidedAt })
          : undefined,
      stream: 'decision',
      rows: page.map((row) => ({
        actorReference: row.actorReference,
        audience: undefined,
        correlationId: undefined,
        id: row.id,
        occurredAt: row.decidedAt,
        outcome: row.reasonCode,
        stream: 'decision' as const,
        subjectType: row.targetType,
        what: row.action,
      })),
    };
  }
}
