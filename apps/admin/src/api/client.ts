import {
  attempt,
  createVeloraApiClient,
  type ApiResult,
} from '@velora/api-client';

import type {
  AdminAccountList,
  AdminAuditPage,
  AdminAuditStream,
  AdminClubList,
  AdminCreatorList,
  AdminOverview,
  AdminPaymentDetail,
  AdminPaymentList,
  AdminPayoutList,
  AdminSession,
  AiSuggestion,
  AiSuggestionBody,
  AppealList,
  AppealOutcomeBody,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketList,
  SupportTicketStatus,
  SupportTicketUpdateBody,
  CaseDetail,
  CreatorEnforcement,
  DecisionBody,
  EnforcementReasonCode,
  DisputeList,
  FinancialState,
  IdentityState,
  IssueRefundBody,
  IssuedRefund,
  LocalAdminSessionBody,
  MediaState,
  ModerationQueue,
  NotificationState,
  ObjectRemovalBody,
  RtcState,
  SafetyCase,
  SafetyCaseList,
  TriageBody,
} from './contract';

/**
 * The operator surface, once.
 *
 * Every call goes through the generated client with its literal contract path,
 * so a route, body, or response that changes is a compile error here rather
 * than a runtime surprise in a screen. Nothing in this module knows a table, a
 * repository, or a server-side rule: it moves requests and classifies answers,
 * and every authorization decision belongs to the server.
 *
 * How a request proves who is making it is the only thing injected. Platform
 * Admin sends an `HttpOnly` `__Host-` cookie the script cannot read plus a CSRF
 * echo on writes — and never a bearer token in browser storage, which ADR-0017
 * forbids and which a privileged surface is the last place to make an exception
 * for.
 *
 * A read carries no CSRF header because a read changes nothing, and sending one
 * anyway would spread a value the server does not want spread.
 */

const csrfCookieName = '__Host-velora_platform_admin_csrf';
const csrfHeaderName = 'x-velora-csrf';
const idempotencyHeaderName = 'x-velora-idempotency-key';

export function readAdminCsrfToken(cookieSource: string): string | undefined {
  for (const part of cookieSource.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== csrfCookieName) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export interface AdminApi {
  /* --- Session ------------------------------------------------------- */
  createLocalAdminSession(
    body: LocalAdminSessionBody,
  ): Promise<ApiResult<AdminSession>>;
  session(): Promise<ApiResult<AdminSession>>;
  signOut(): Promise<ApiResult<unknown>>;
  /** Creates a review-only draft. It cannot decide or execute a case action. */
  suggestAi(
    body: AiSuggestionBody,
    signal?: AbortSignal,
  ): Promise<ApiResult<AiSuggestion>>;
  cancelAi(
    runId: string,
  ): Promise<
    ApiResult<{ readonly cancelled: boolean; readonly runId: string }>
  >;

  /* --- Operations ---------------------------------------------------- */
  /** What needs a person, counted by the platform rather than by a page. */
  overview(): Promise<ApiResult<AdminOverview>>;
  /**
   * Consumer accounts. With no status asked for the platform answers with the
   * accounts it has itself decided are not in good standing, which is what
   * keeps this from being a directory of everybody.
   */
  accounts(query?: {
    readonly accountId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
    readonly status?: string | undefined;
  }): Promise<ApiResult<AdminAccountList>>;
  /** The clubs creators sell, and the memberships of one of them. */
  clubs(query?: {
    readonly clubId?: string | undefined;
    readonly creatorId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<AdminClubList>>;
  /** What has happened, from whichever of the two records keeps it. */
  audit(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
    readonly stream?: AdminAuditStream | undefined;
  }): Promise<ApiResult<AdminAuditPage>>;

  /* --- Money --------------------------------------------------------- */
  financialState(): Promise<ApiResult<FinancialState>>;
  payments(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
    readonly state?: string | undefined;
  }): Promise<ApiResult<AdminPaymentList>>;
  /** One payment with every reversal and claim recorded against it. */
  payment(paymentId: string): Promise<ApiResult<AdminPaymentDetail>>;
  payouts(query?: {
    readonly creatorId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
    readonly state?: string | undefined;
  }): Promise<ApiResult<AdminPayoutList>>;
  /**
   * The dispute queue, newest claim first.
   *
   * A read and only a read. There is no evidence submission anywhere in this
   * client, because whether VELORA may submit evidence, in what form, and
   * through which provider is unresolved — and a control that accepted a file
   * and did nothing with it would be worse than its absence.
   */
  disputes(query?: {
    readonly open?: boolean;
    readonly pageSize?: number;
  }): Promise<ApiResult<DisputeList>>;
  /**
   * The one financial operation an operator has. It carries an idempotency key
   * because a retried refund that produced a second refund would be money the
   * platform cannot get back.
   */
  issueRefund(input: {
    readonly body: IssueRefundBody;
    readonly idempotencyKey: string;
  }): Promise<ApiResult<IssuedRefund>>;

  /* --- Platform health ----------------------------------------------- */
  mediaState(): Promise<ApiResult<MediaState>>;
  notificationState(): Promise<ApiResult<NotificationState>>;
  rtcState(): Promise<ApiResult<RtcState>>;
  identityState(): Promise<ApiResult<IdentityState>>;

  /* --- Creators ------------------------------------------------------ */
  creators(query?: {
    readonly adminSearch?: string | undefined;
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<AdminCreatorList>>;
  suspendCreator(input: {
    readonly creatorId: string;
    readonly reasonCode: EnforcementReasonCode;
  }): Promise<ApiResult<CreatorEnforcement>>;
  reinstateCreator(input: {
    readonly creatorId: string;
    readonly reasonCode: EnforcementReasonCode;
  }): Promise<ApiResult<CreatorEnforcement>>;
  revokeClubMembership(input: {
    readonly creatorId: string;
    readonly membershipId: string;
    readonly reasonCode: EnforcementReasonCode;
  }): Promise<ApiResult<CreatorEnforcement>>;
  removeCreatorObject(
    body: ObjectRemovalBody,
  ): Promise<ApiResult<CreatorEnforcement>>;

  /* --- Safety -------------------------------------------------------- */
  cases(query?: {
    readonly cursor?: string | undefined;
    readonly moderationQueue?: ModerationQueue | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<SafetyCaseList>>;
  caseDetail(caseId: string): Promise<ApiResult<CaseDetail>>;
  /**
   * Records what an operator found, as evidence of the case's own kind.
   *
   * A note is evidence rather than a comment thread: it goes into the same
   * append-only record a decision has to cite, it can never be edited or
   * deleted, and the operator who wrote it is recorded. That is the difference
   * between an investigation an appeal can be answered from and a chat log.
   */
  addCaseNote(input: {
    readonly caseId: string;
    readonly note: string;
  }): Promise<ApiResult<SafetyCase>>;
  claimCase(caseId: string): Promise<ApiResult<SafetyCase>>;
  triageCase(body: TriageBody): Promise<ApiResult<SafetyCase>>;
  decideCase(body: DecisionBody): Promise<ApiResult<unknown>>;
  appeals(query?: {
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<AppealList>>;
  resolveAppeal(body: AppealOutcomeBody): Promise<ApiResult<unknown>>;
  /** The support queue. Oldest first, optionally narrowed to one status. */
  supportTickets(query?: {
    readonly pageSize?: number | undefined;
    readonly status?: SupportTicketStatus | undefined;
  }): Promise<ApiResult<SupportTicketList>>;
  supportTicket(ticketId: string): Promise<ApiResult<SupportTicketDetail>>;
  /**
   * The only write an operator has on a ticket. There is no path from here to
   * an account status, an enforcement, or a balance.
   */
  updateSupportTicket(
    body: SupportTicketUpdateBody,
  ): Promise<ApiResult<SupportTicket>>;
}

export interface AdminApiOptions {
  readonly apiBaseUrl: string;
  readonly cookieSource?: () => string;
  /** Injected by tests so the console runs without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Only the values a caller actually supplied travel on the wire.
 *
 * Written as explicit conditional spreads rather than by filtering an object,
 * because the contract's query types do not admit `undefined` and a filter that
 * produced the right value at runtime would still be the wrong type.
 */
function pageQuery(query?: {
  readonly cursor?: string | undefined;
  readonly pageSize?: number | undefined;
}): { cursor?: string; pageSize?: number } {
  return {
    ...(query?.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query?.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
}

export function createAdminApi(options: AdminApiOptions): AdminApi {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const cookies =
    options.cookieSource ??
    (() => (typeof document === 'undefined' ? '' : document.cookie));

  const read = () => ({ credentials: 'include' as const });
  const write = (signal?: AbortSignal) => {
    const token = readAdminCsrfToken(cookies());
    return {
      credentials: 'include' as const,
      headers: token === undefined ? {} : { [csrfHeaderName]: token },
      ...(signal === undefined ? {} : { signal }),
    };
  };

  return {
    async suggestAi(body, signal) {
      return attempt(async () =>
        api.POST('/v1/ai/suggestions', { ...write(signal), body }),
      );
    },

    async cancelAi(runId) {
      return attempt(async () =>
        api.POST('/v1/ai/runs/cancellation', {
          ...write(),
          body: { runId },
        }),
      );
    },

    async accounts(query) {
      return attempt(async () =>
        api.GET('/v1/admin/accounts', {
          ...read(),
          params: {
            query: {
              ...(query?.accountId === undefined
                ? {}
                : { accountId: query.accountId }),
              ...pageQuery(query),
              ...(query?.status === undefined ? {} : { status: query.status }),
            },
          },
        }),
      );
    },

    async audit(query) {
      return attempt(async () =>
        api.GET('/v1/admin/audit', {
          ...read(),
          params: {
            query: {
              ...pageQuery(query),
              ...(query?.stream === undefined ? {} : { stream: query.stream }),
            },
          },
        }),
      );
    },

    async clubs(query) {
      return attempt(async () =>
        api.GET('/v1/admin/clubs', {
          ...read(),
          params: {
            query: {
              ...(query?.clubId === undefined ? {} : { clubId: query.clubId }),
              ...(query?.creatorId === undefined
                ? {}
                : { creatorId: query.creatorId }),
              ...pageQuery(query),
            },
          },
        }),
      );
    },

    async overview() {
      return attempt(async () => api.GET('/v1/admin/overview', read()));
    },

    async payment(paymentId) {
      return attempt(async () =>
        api.GET('/v1/admin/billing/payment', {
          ...read(),
          params: { query: { paymentId } },
        }),
      );
    },

    async payments(query) {
      return attempt(async () =>
        api.GET('/v1/admin/billing/payments', {
          ...read(),
          params: {
            query: {
              ...pageQuery(query),
              ...(query?.state === undefined ? {} : { state: query.state }),
            },
          },
        }),
      );
    },

    async payouts(query) {
      return attempt(async () =>
        api.GET('/v1/admin/payouts', {
          ...read(),
          params: {
            query: {
              ...(query?.creatorId === undefined
                ? {}
                : { creatorId: query.creatorId }),
              ...pageQuery(query),
              ...(query?.state === undefined ? {} : { state: query.state }),
            },
          },
        }),
      );
    },

    async appeals(query) {
      return attempt(async () =>
        api.GET('/v1/admin/safety/appeals', {
          ...read(),
          params: {
            query:
              query?.pageSize === undefined ? {} : { pageSize: query.pageSize },
          },
        }),
      );
    },

    async addCaseNote(input) {
      const result = await attempt(async () =>
        api.POST('/v1/admin/safety/cases/notes', { ...write(), body: input }),
      );
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: result.value.case }
        : result;
    },

    async caseDetail(caseId) {
      return attempt(async () =>
        api.GET('/v1/admin/safety/case', {
          ...read(),
          params: { query: { caseId } },
        }),
      );
    },

    async cases(query) {
      return attempt(async () =>
        api.GET('/v1/admin/safety/cases', {
          ...read(),
          params: {
            query: {
              ...pageQuery(query),
              ...(query?.moderationQueue === undefined
                ? {}
                : { moderationQueue: query.moderationQueue }),
            },
          },
        }),
      );
    },

    async claimCase(caseId) {
      const result = await attempt(async () =>
        api.POST('/v1/admin/safety/cases/claim', {
          ...write(),
          body: { caseId },
        }),
      );
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: result.value.case }
        : result;
    },

    async creators(query) {
      return attempt(async () =>
        api.GET('/v1/admin/creators', {
          ...read(),
          params: {
            query: {
              ...(query?.adminSearch === undefined
                ? {}
                : { adminSearch: query.adminSearch }),
              ...pageQuery(query),
            },
          },
        }),
      );
    },

    async decideCase(body) {
      return attempt(async () =>
        api.POST('/v1/admin/safety/cases/decisions', { ...write(), body }),
      );
    },

    async disputes(query) {
      return attempt(async () =>
        api.GET('/v1/admin/billing/disputes', {
          ...read(),
          params: {
            query: {
              ...(query?.open === undefined
                ? {}
                : { open: query.open ? 'true' : 'false' }),
              ...(query?.pageSize === undefined
                ? {}
                : { pageSize: query.pageSize }),
            },
          },
        }),
      );
    },

    async financialState() {
      return attempt(async () => api.GET('/v1/admin/billing/state', read()));
    },

    async identityState() {
      return attempt(async () => api.GET('/v1/admin/identity/state', read()));
    },

    async issueRefund(input) {
      const authenticated = write();
      const result = await attempt(async () =>
        api.POST('/v1/admin/billing/refunds', {
          ...authenticated,
          body: input.body,
          headers: {
            ...authenticated.headers,
            [idempotencyHeaderName]: input.idempotencyKey,
          },
        }),
      );
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: result.value.refund }
        : result;
    },

    async mediaState() {
      return attempt(async () => api.GET('/v1/admin/media/state', read()));
    },

    async notificationState() {
      return attempt(async () =>
        api.GET('/v1/admin/notifications/state', read()),
      );
    },

    async reinstateCreator(input) {
      return attempt(async () =>
        api.POST('/v1/admin/creators/reinstatement', {
          ...write(),
          body: input,
        }),
      );
    },

    async removeCreatorObject(body) {
      return attempt(async () =>
        api.POST('/v1/admin/creators/object-removal', { ...write(), body }),
      );
    },

    async resolveAppeal(body) {
      return attempt(async () =>
        api.POST('/v1/admin/safety/appeals/outcome', { ...write(), body }),
      );
    },

    async supportTickets(query) {
      return attempt(async () =>
        api.GET('/v1/admin/support/tickets', {
          ...read(),
          params: {
            query: {
              ...(query?.pageSize === undefined
                ? {}
                : { pageSize: query.pageSize }),
              ...(query?.status === undefined ? {} : { status: query.status }),
            },
          },
        }),
      );
    },

    async supportTicket(ticketId) {
      return attempt(async () =>
        api.GET('/v1/admin/support/ticket', {
          ...read(),
          params: { query: { ticketId } },
        }),
      );
    },

    async updateSupportTicket(body) {
      return attempt(async () =>
        api.POST('/v1/admin/support/tickets/update', { ...write(), body }),
      );
    },

    async revokeClubMembership(input) {
      return attempt(async () =>
        api.POST('/v1/admin/creators/membership-revocation', {
          ...write(),
          body: input,
        }),
      );
    },

    async rtcState() {
      return attempt(async () => api.GET('/v1/admin/rtc/state', read()));
    },

    async createLocalAdminSession(body) {
      return attempt(async () =>
        api.POST('/v1/auth/local/admin-sessions', {
          credentials: 'include',
          body,
        }),
      );
    },

    async session() {
      return attempt(async () => api.GET('/v1/auth/session', read()));
    },

    async signOut() {
      return attempt(async () => api.POST('/v1/auth/logout', write()));
    },

    async suspendCreator(input) {
      return attempt(async () =>
        api.POST('/v1/admin/creators/suspension', { ...write(), body: input }),
      );
    },

    async triageCase(body) {
      const result = await attempt(async () =>
        api.POST('/v1/admin/safety/cases/triage', { ...write(), body }),
      );
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: result.value.case }
        : result;
    },
  };
}
