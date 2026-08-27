import type { paths } from '@velora/api-client';

/**
 * The operator product shapes, named once and derived from the generated
 * document.
 *
 * Platform Admin consumes these rather than re-declaring what a case or a
 * backlog looks like, so a contract change is a compile error here instead of a
 * runtime surprise in a screen. Nothing in this module knows a table, a
 * repository, or a server-side rule.
 *
 * These live inside the app rather than in a package. `packages/consumer-client`
 * and `packages/creator-client` exist because two surfaces each consume them;
 * exactly one surface consumes this, and a workspace built for one consumer is
 * an abstraction with nothing to abstract over. It moves the day a second
 * consumer exists.
 */

type JsonBody<
  TPath extends keyof paths,
  TMethod extends keyof paths[TPath],
  TStatus extends number,
> = paths[TPath][TMethod] extends {
  responses: Record<TStatus, { content: { 'application/json': infer TBody } }>;
}
  ? TBody
  : never;

type RequestBody<
  TPath extends keyof paths,
  TMethod extends keyof paths[TPath],
> = paths[TPath][TMethod] extends {
  requestBody: { content: { 'application/json': infer TBody } };
}
  ? TBody
  : never;

/* ================================ Shared ============================= */

/**
 * The shape almost every operational read is made of: a state and how many
 * things are in it. Three domains publish it and the console renders it the
 * same way each time, because an operator comparing two subsystems should not
 * have to learn two tables.
 */
export interface StateCount {
  readonly count: number;
  readonly state: string;
}

/**
 * Owed work, with the age of its oldest member and the age at which that
 * becomes an alert.
 *
 * A count alone cannot separate a busy platform from a stuck one — forty purges
 * owed for forty-five seconds and one owed for a day are the same row and
 * opposite situations. The threshold comes from the owning domain, which
 * derives it from the deadlines its own sweeps run on, so the console cannot
 * call work late that the platform is still working on.
 */
export interface Backlog {
  readonly breached: boolean;
  readonly count: number;
  readonly oldestAgeSeconds?: number;
  readonly state: string;
  readonly thresholdSeconds: number;
}

/* ================================ Money ============================== */

export type FinancialState = JsonBody<'/v1/admin/billing/state', 'get', 200>;
export type CurrencyTotal = FinancialState['payableTotals'][number];
export type IssueRefundBody = RequestBody<'/v1/admin/billing/refunds', 'post'>;
export type IssuedRefund = JsonBody<
  '/v1/admin/billing/refunds',
  'post',
  201
>['refund'];
export type RefundReasonCode = IssueRefundBody['reasonCode'];

/* ================================ Media ============================== */

export type MediaState = JsonBody<'/v1/admin/media/state', 'get', 200>;

/* =============================== Creators ============================ */

export type AdminCreatorList = JsonBody<'/v1/admin/creators', 'get', 200>;
export type AdminCreator = AdminCreatorList['creators'][number];
export type CreatorEnforcement = JsonBody<
  '/v1/admin/creators/suspension',
  'post',
  200
>;
export type EnforcementReasonCode = CreatorEnforcement['reasonCode'];
export type EnforcementScope = CreatorEnforcement['scope'];
export type ObjectRemovalBody = RequestBody<
  '/v1/admin/creators/object-removal',
  'post'
>;
export type RemovableObjectType = ObjectRemovalBody['objectType'];

/* ================================ Safety ============================= */

export type SafetyCaseList = JsonBody<'/v1/admin/safety/cases', 'get', 200>;
export type SafetyCase = SafetyCaseList['cases'][number];
export type ModerationQueue = SafetyCase['queue'];
export type CasePriority = SafetyCase['priority'];
export type CaseDetail = JsonBody<'/v1/admin/safety/case', 'get', 200>;
export type CaseDecision = CaseDetail['decisions'][number];
export type CaseEvidence = CaseDetail['evidence'][number];
export type CaseReport = CaseDetail['reports'][number];
export type TriageBody = RequestBody<'/v1/admin/safety/cases/triage', 'post'>;
export type DecisionBody = RequestBody<
  '/v1/admin/safety/cases/decisions',
  'post'
>;
export type DecisionAction = DecisionBody['action'];
export type DecisionReasonCode = DecisionBody['reasonCode'];
export type AppealList = JsonBody<'/v1/admin/safety/appeals', 'get', 200>;
export type Appeal = AppealList['appeals'][number];
export type AppealOutcomeBody = RequestBody<
  '/v1/admin/safety/appeals/outcome',
  'post'
>;

/* ============================= Notifications ========================= */

export type NotificationState = JsonBody<
  '/v1/admin/notifications/state',
  'get',
  200
>;

/* ================================= RTC =============================== */

export type RtcState = JsonBody<'/v1/admin/rtc/state', 'get', 200>;

/* =============================== Identity ============================ */

export type IdentityState = JsonBody<'/v1/admin/identity/state', 'get', 200>;
export type IdentityAttempt = IdentityState['attempts'][number];

/* ================================ Session ============================ */

export type AdminSession = JsonBody<'/v1/auth/session', 'get', 200>;
export type LocalAdminSessionBody = RequestBody<
  '/v1/auth/local/admin-sessions',
  'post'
>;

/** AI may summarize a case; the operator still reviews and decides. */
export type AiSuggestionBody = RequestBody<'/v1/ai/suggestions', 'post'>;
export type AiSuggestion = JsonBody<'/v1/ai/suggestions', 'post', 200>;
