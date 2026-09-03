import type { SafeLogger } from '@velora/observability/server';

import { decodeSupportCursor, encodeSupportCursor } from './cursor.js';
import {
  mayTransition,
  maximumOpenSupportTickets,
  maximumSupportPageSize,
  supportReferenceAlphabet,
  supportReferenceAttempts,
  supportReferenceGroupLength,
  supportTicketRateLimitCount,
  supportTicketRateWindowMilliseconds,
  type SupportCategory,
  type SupportTicketStatus,
} from './policy.js';
import type {
  SupportRepository,
  SupportTicketEventRow,
  SupportTicketRow,
} from './repository.js';

export interface SupportTicketView {
  readonly category: SupportCategory;
  readonly createdAt: Date;
  readonly description: string;
  readonly id: string;
  readonly ownerId: string;
  readonly reference: string;
  readonly status: SupportTicketStatus;
  readonly subject: string;
  readonly updatedAt: Date;
}

export type SupportTicketOutcome =
  | { readonly kind: 'ticket'; readonly view: SupportTicketView }
  /** Too many submissions in the window, or too many still unanswered. */
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'not_found' };

export type SupportTicketListOutcome =
  | {
      readonly kind: 'page';
      readonly nextCursor: string | undefined;
      readonly tickets: readonly SupportTicketView[];
    }
  | { readonly kind: 'invalid_cursor' };

export type SupportTicketDetailOutcome =
  | {
      readonly kind: 'ticket';
      readonly events: readonly SupportTicketEventRow[];
      readonly view: SupportTicketView;
    }
  | { readonly kind: 'not_found' };

export type SupportTransitionOutcome =
  | { readonly kind: 'ticket'; readonly view: SupportTicketView }
  | { readonly kind: 'not_found' }
  /** The move is not one this status may make. */
  | { readonly kind: 'not_permitted' };

function ticketView(row: SupportTicketRow): SupportTicketView {
  return {
    category: row.category,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    ownerId: row.ownerId,
    reference: row.reference,
    status: row.status,
    subject: row.subject,
    updatedAt: row.updatedAt,
  };
}

/**
 * Consumer support.
 *
 * The competitor complaint this answers is the flattest one in the category:
 * there is no way to reach anybody. An address in a policy document is not a
 * support path, because the person using it can never tell whether anything
 * happened — so the property this service exists to provide is that after
 * somebody submits, they hold a reference they can read back and a status that
 * is the server's answer rather than a promise a screen made.
 *
 * Three rules shape it.
 *
 * **Nothing here is gated on standing.** An account that is restricted, whose
 * adult assurance has lapsed, or that is mid-deletion may still open a ticket —
 * those are exactly the accounts most likely to need one, and requiring good
 * standing would deny help to precisely the people asking why they cannot use
 * the product. This is the same rule TRUST & SAFETY applies to blocking and
 * reporting, for the same reason.
 *
 * **A ticket can never change anything.** It records what somebody asked and
 * what an operator said about it. There is no code path from this service to an
 * account status, an enforcement, a wallet balance, or a block — a support
 * ticket that could restrict an account would be an enforcement path with none
 * of the audit, dual control, or appeal rights the real one carries.
 *
 * **Nobody is promised a response time.** No shape this service produces
 * carries a deadline, a queue position, or an estimate, because VELORA has
 * nobody on a rota and a deadline it cannot keep is worse than no deadline.
 */
export class SupportService {
  constructor(
    private readonly dependencies: {
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly repository: SupportRepository;
      /** Injectable so a test can assert a reference collision is survivable. */
      readonly reference?: () => string;
    },
  ) {}

  /**
   * Opens a ticket.
   *
   * Retry-safe on the submitter's own client identifier, which matters more
   * here than almost anywhere else: the connection that lost the response is
   * quite often the thing the ticket is about, and a person who taps again
   * should not end up with two.
   *
   * Two bounds, and they stop different things. The rate bound stops a burst.
   * The open-ticket bound stops a backlog nobody could answer being built one
   * ticket a day, and somebody at it is told to add to what they already have
   * rather than told to go away.
   */
  async open(input: {
    readonly category: SupportCategory;
    readonly clientTicketId: string;
    readonly description: string;
    readonly ownerId: string;
    readonly subject: string;
  }): Promise<SupportTicketOutcome> {
    const { repository } = this.dependencies;
    const existing = await repository.findByClientTicketId(
      repository.transactionless,
      { clientTicketId: input.clientTicketId, ownerId: input.ownerId },
    );
    // A retry of the same submission is the same ticket, answered before any
    // bound is consulted: a person whose response was lost must not be refused
    // for a submission they already made.
    if (existing !== undefined) {
      return { kind: 'ticket', view: ticketView(existing) };
    }

    const now = this.dependencies.now();
    const recent = await repository.countTicketsSince(
      repository.transactionless,
      {
        ownerId: input.ownerId,
        since: new Date(now.getTime() - supportTicketRateWindowMilliseconds),
      },
    );
    if (recent >= supportTicketRateLimitCount) return { kind: 'rate_limited' };
    const open = await repository.countOpenTickets(
      repository.transactionless,
      input.ownerId,
    );
    if (open >= maximumOpenSupportTickets) return { kind: 'rate_limited' };

    const row = await repository.transaction(async (executor) => {
      const reference = await this.allocateReference(executor);
      const created = await repository.insertTicket(executor, {
        category: input.category,
        clientTicketId: input.clientTicketId,
        description: input.description,
        id: crypto.randomUUID(),
        now,
        ownerId: input.ownerId,
        reference,
        subject: input.subject,
      });
      if (created === undefined) {
        // The unique index refused it, so a simultaneous submission of the same
        // client identifier won. Theirs is the ticket.
        return repository.findByClientTicketId(executor, {
          clientTicketId: input.clientTicketId,
          ownerId: input.ownerId,
        });
      }
      await repository.insertEvent(executor, {
        actorReference: null,
        id: crypto.randomUUID(),
        kind: 'opened',
        note: null,
        now,
        status: 'received',
        ticketId: created.id,
      });
      return created;
    });
    if (row === undefined) return { kind: 'not_found' };

    // An operational signal, and deliberately not the ticket. The category and
    // the reference are what an operator needs to notice a spike or find the
    // row; the subject and the description are the person's own words about
    // their own problem and have no business in a log line.
    this.dependencies.logger.info(
      { category: row.category, reference: row.reference },
      'support.ticket.opened',
    );
    return { kind: 'ticket', view: ticketView(row) };
  }

  /** One ticket, if it is the caller's. Somebody else's is simply not found. */
  async ownTicket(input: {
    readonly ownerId: string;
    readonly ticketId: string;
  }): Promise<SupportTicketOutcome> {
    const { repository } = this.dependencies;
    const row = await repository.findById(
      repository.transactionless,
      input.ticketId,
    );
    // A ticket belonging to somebody else answers exactly as one that does not
    // exist, so an identifier cannot be probed for whether it is real.
    if (row?.ownerId !== input.ownerId) return { kind: 'not_found' };
    return { kind: 'ticket', view: ticketView(row) };
  }

  /** The caller's own tickets. There is no route to anybody else's. */
  async listOwn(input: {
    readonly cursor: string | undefined;
    readonly ownerId: string;
    readonly pageSize: number;
  }): Promise<SupportTicketListOutcome> {
    const decoded =
      input.cursor === undefined
        ? undefined
        : decodeSupportCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize, maximumSupportPageSize),
    );
    const rows = await this.dependencies.repository.listForOwner(
      this.dependencies.repository.transactionless,
      { before: decoded, limit: pageSize + 1, ownerId: input.ownerId },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeSupportCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
      tickets: page.map(ticketView),
    };
  }

  /* ------------------------------------------------------- operator side */

  /** The operator queue, oldest first, optionally narrowed to one status. */
  async listForOperator(input: {
    readonly cursor: string | undefined;
    readonly pageSize: number;
    readonly status: SupportTicketStatus | undefined;
  }): Promise<SupportTicketListOutcome> {
    const decoded =
      input.cursor === undefined
        ? undefined
        : decodeSupportCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize, maximumSupportPageSize),
    );
    const rows = await this.dependencies.repository.listForOperator(
      this.dependencies.repository.transactionless,
      { after: decoded, limit: pageSize + 1, status: input.status },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeSupportCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
      tickets: page.map(ticketView),
    };
  }

  /** One ticket and everything recorded against it. Operator-facing. */
  async operatorTicket(ticketId: string): Promise<SupportTicketDetailOutcome> {
    const { repository } = this.dependencies;
    const row = await repository.findById(repository.transactionless, ticketId);
    if (row === undefined) return { kind: 'not_found' };
    const events = await repository.listEvents(repository.transactionless, {
      limit: maximumSupportPageSize,
      ticketId,
    });
    return { events, kind: 'ticket', view: ticketView(row) };
  }

  /**
   * Moves a ticket, and records why when an operator said.
   *
   * The lock is taken first and the transition is a compare-and-set inside it,
   * so two operators acting at the same instant cannot both apply a move
   * computed from the same stale status.
   *
   * A move to the status a ticket is already in is answered idempotently and
   * records nothing: a second event saying "still resolved" would be an entry
   * in an append-only history that describes no change, which is exactly what
   * makes such a history stop being readable. A note supplied alongside it is
   * still recorded, because an operator writing one meant to write it.
   */
  async transition(input: {
    readonly actorReference: string;
    readonly note: string | undefined;
    readonly status: SupportTicketStatus;
    readonly ticketId: string;
  }): Promise<SupportTransitionOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(
      async (executor): Promise<SupportTransitionOutcome> => {
        const current = await repository.lockTicket(executor, input.ticketId);
        if (current === undefined) return { kind: 'not_found' };

        const unchanged = current.status === input.status;
        if (!unchanged && !mayTransition(current.status, input.status)) {
          return { kind: 'not_permitted' };
        }

        if (input.note !== undefined) {
          await repository.insertEvent(executor, {
            actorReference: input.actorReference,
            id: crypto.randomUUID(),
            kind: 'note',
            note: input.note,
            now,
            status: null,
            ticketId: current.id,
          });
        }
        if (unchanged) return { kind: 'ticket', view: ticketView(current) };

        const moved = await repository.transitionStatus(executor, {
          expectedStatus: current.status,
          id: current.id,
          now,
          status: input.status,
        });
        if (moved === undefined) return { kind: 'not_permitted' };
        await repository.insertEvent(executor, {
          actorReference: input.actorReference,
          id: crypto.randomUUID(),
          kind: 'status_changed',
          note: null,
          now,
          status: input.status,
          ticketId: current.id,
        });
        return { kind: 'ticket', view: ticketView(moved) };
      },
    );
  }

  /**
   * A reference nobody holds yet.
   *
   * Generated rather than derived from a counter, because a sequential
   * reference would tell every person who ever opened a ticket how many the
   * platform has had — a business fact nobody decided to publish. Forty bits of
   * choice against a small table makes a collision a rare event rather than an
   * impossible one, so it is checked and retried a bounded number of times; the
   * unique index is still the guarantee, and this only keeps the ordinary case
   * off it.
   */
  private async allocateReference(
    executor: Parameters<SupportRepository['referenceExists']>[0],
  ): Promise<string> {
    const mint = this.dependencies.reference ?? mintSupportReference;
    for (let attempt = 0; attempt < supportReferenceAttempts; attempt += 1) {
      const candidate = mint();
      if (
        !(await this.dependencies.repository.referenceExists(
          executor,
          candidate,
        ))
      ) {
        return candidate;
      }
    }
    throw new Error('Could not allocate an unused support reference');
  }
}

/**
 * One reference, in the published shape.
 *
 * `crypto.getRandomValues` rather than `Math.random`: this is not a credential,
 * but it is an identifier a person quotes, and a predictable one would let
 * somebody guess a reference that belongs to somebody else and quote it at an
 * operator. The modulo bias across a 32-character alphabet drawn from bytes is
 * removed by rejecting the tail of the byte range rather than ignored.
 */
export function mintSupportReference(): string {
  const alphabet = supportReferenceAlphabet;
  const limit = 256 - (256 % alphabet.length);
  const characters: string[] = [];
  const buffer = new Uint8Array(1);
  while (characters.length < supportReferenceGroupLength * 2) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0] ?? 0;
    if (byte >= limit) continue;
    characters.push(alphabet[byte % alphabet.length] ?? '0');
  }
  const first = characters.slice(0, supportReferenceGroupLength).join('');
  const second = characters.slice(supportReferenceGroupLength).join('');
  return `VS-${first}-${second}`;
}
