import { eq, sql } from 'drizzle-orm';

import { billingPayments } from '../billing/schema.js';
import { creatorAccounts, creatorProfiles } from '../creators/schema.js';
import type { DatabaseHandle } from '../database/executor.js';
import { bounded } from '../database/fan-out.js';
import { growthInvites } from '../growth/schema.js';
import { liveEncounters } from '../live/schema.js';
import { messagingConversations } from '../messaging/schema.js';
import { safetyCases, safetyReports } from '../safety/schema.js';
import { supportTickets } from '../support/schema.js';
import { userAccounts } from '../users/schema.js';

/**
 * One box an operator types an identifier into.
 *
 * The problem it solves is small and constant: somebody is holding a reference
 * — from a ticket, a log line, a message, a screenshot — and does not know
 * which screen it belongs to. Without this they open five and guess. With it
 * they paste it once.
 *
 * Two rules shape the whole module.
 *
 * **It resolves, it does not suggest.** There is no prefix matching, no
 * autocomplete, and no partial handle search. A suggestion list over identifiers
 * is an enumeration tool: type three characters, learn what exists. Every lookup
 * here is an exact match on something the operator already holds, so a wrong
 * guess reveals nothing but that the guess was wrong.
 *
 * **It never widens what an operator may see.** A match is a pointer — a kind,
 * an identifier, and a word or two of context — and following it opens the
 * screen that owns that record, where that screen's own capability check
 * applies. Finding a case does not read the case.
 */

export const searchMatchKinds = [
  'account',
  'case',
  'conversation',
  'creator',
  'encounter',
  'invite',
  'payment',
  'report',
  'ticket',
] as const;
export type SearchMatchKind = (typeof searchMatchKinds)[number];

export interface SearchMatch {
  /** A short, safe descriptor: a status, a state, a category. Never content. */
  readonly context: string | undefined;
  readonly id: string;
  readonly kind: SearchMatchKind;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const handlePattern = /^[a-z0-9_]{2,32}$/u;
const inviteCodePattern = /^[a-z0-9]{22}$/u;
/** SUPPORT's public reference, which is what somebody quotes in an email. */
const supportReferencePattern = /^[A-Z0-9-]{4,32}$/u;

export class AdminSearchDirectory {
  constructor(private readonly database: DatabaseHandle) {}

  /**
   * Everything this exact value could be.
   *
   * A value's shape decides which tables are asked, so a handle never probes
   * the payment table and a UUID never probes the invitation table. The lookups
   * that survive that filter run a few at a time, because a UUID is genuinely
   * ambiguous — an account, a case, an encounter and a payment all wear the
   * same shape, and an operator holding one usually does not know which. Eight
   * single-row lookups issued at once would take eight pooled connections for
   * one keystroke; `bounded` keeps them to three. See `../database/fan-out.ts`.
   */
  async resolve(term: string): Promise<readonly SearchMatch[]> {
    const value = term.trim();
    if (value.length === 0) return [];

    if (uuidPattern.test(value.toLowerCase())) {
      return this.resolveIdentifier(value.toLowerCase());
    }
    if (inviteCodePattern.test(value)) return this.resolveInviteCode(value);
    if (handlePattern.test(value.toLowerCase())) {
      return this.resolveHandle(value.toLowerCase());
    }
    if (supportReferencePattern.test(value.toUpperCase())) {
      return this.resolveSupportReference(value.toUpperCase());
    }
    // A shape nothing in this product uses. Answering with nothing is the
    // truthful answer and costs no query at all.
    return [];
  }

  private async resolveIdentifier(id: string): Promise<readonly SearchMatch[]> {
    const [
      accounts,
      creators,
      cases,
      reports,
      encounters,
      conversations,
      payments,
      tickets,
    ] = await bounded([
      async () =>
        this.database
          .select({ id: userAccounts.id, status: userAccounts.status })
          .from(userAccounts)
          .where(eq(userAccounts.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: creatorAccounts.id, status: creatorAccounts.status })
          .from(creatorAccounts)
          .where(eq(creatorAccounts.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: safetyCases.id, state: safetyCases.state })
          .from(safetyCases)
          .where(eq(safetyCases.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: safetyReports.id, state: safetyReports.state })
          .from(safetyReports)
          .where(eq(safetyReports.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: liveEncounters.id, state: liveEncounters.state })
          .from(liveEncounters)
          .where(eq(liveEncounters.id, id))
          .limit(1),
      async () =>
        this.database
          .select({
            id: messagingConversations.id,
            state: messagingConversations.state,
          })
          .from(messagingConversations)
          .where(eq(messagingConversations.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: billingPayments.id, state: billingPayments.state })
          .from(billingPayments)
          .where(eq(billingPayments.id, id))
          .limit(1),
      async () =>
        this.database
          .select({ id: supportTickets.id, status: supportTickets.status })
          .from(supportTickets)
          .where(eq(supportTickets.id, id))
          .limit(1),
    ]);

    const matches: SearchMatch[] = [];
    for (const row of accounts) {
      matches.push({ context: row.status, id: row.id, kind: 'account' });
    }
    for (const row of creators) {
      matches.push({ context: row.status, id: row.id, kind: 'creator' });
    }
    for (const row of cases) {
      matches.push({ context: row.state, id: row.id, kind: 'case' });
    }
    for (const row of reports) {
      matches.push({ context: row.state, id: row.id, kind: 'report' });
    }
    for (const row of encounters) {
      matches.push({ context: row.state, id: row.id, kind: 'encounter' });
    }
    for (const row of conversations) {
      matches.push({ context: row.state, id: row.id, kind: 'conversation' });
    }
    for (const row of payments) {
      matches.push({ context: row.state, id: row.id, kind: 'payment' });
    }
    for (const row of tickets) {
      matches.push({ context: row.status, id: row.id, kind: 'ticket' });
    }
    return matches;
  }

  private async resolveHandle(handle: string): Promise<readonly SearchMatch[]> {
    const rows = await this.database
      .select({
        creatorId: creatorProfiles.creatorId,
        publication: creatorProfiles.publication,
      })
      .from(creatorProfiles)
      .where(sql`lower(${creatorProfiles.handle}) = ${handle}`)
      .limit(1);
    return rows.map((row) => ({
      context: row.publication,
      id: row.creatorId,
      kind: 'creator' as const,
    }));
  }

  private async resolveInviteCode(
    code: string,
  ): Promise<readonly SearchMatch[]> {
    const rows = await this.database
      .select({
        id: growthInvites.id,
        inviterUserId: growthInvites.inviterUserId,
        revokedAt: growthInvites.revokedAt,
      })
      .from(growthInvites)
      .where(eq(growthInvites.code, code))
      .limit(1);
    // The invitation, and the account that owns it. An operator chasing invite
    // abuse is always on their way to the second, and making them paste an
    // identifier twice to get there is the friction this box exists to remove.
    return rows.flatMap((row) => [
      {
        context: row.revokedAt === null ? 'active' : 'revoked',
        id: row.id,
        kind: 'invite' as const,
      },
      { context: undefined, id: row.inviterUserId, kind: 'account' as const },
    ]);
  }

  private async resolveSupportReference(
    reference: string,
  ): Promise<readonly SearchMatch[]> {
    const rows = await this.database
      .select({ id: supportTickets.id, status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.reference, reference))
      .limit(1);
    return rows.map((row) => ({
      context: row.status,
      id: row.id,
      kind: 'ticket' as const,
    }));
  }
}
