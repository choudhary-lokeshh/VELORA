import {
  adminControlListResponseSchema,
  adminControlRequestSchema,
  adminControlResponseSchema,
  adminOperatorActionListResponseSchema,
  adminOperatorListResponseSchema,
  adminOperatorResponseSchema,
  adminOperatorRoleRequestSchema,
  adminOperatorRoleResponseSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  operationalControls,
  operatorActionNames,
  operatorActionOutcomes,
  operatorRoles,
  type OperatorActionName,
  type OperatorActionOutcome,
  type OperatorRole,
} from '../operations/policy.js';
import type { OperationsService } from '../operations/service.js';
import { capabilitiesOfRole } from '../operations/policy.js';
import type { AdminContext, AdminContextResolver } from './context.js';

/**
 * The control plane, as routes.
 *
 * Five reads and two commands, and the two commands are the only routes in this
 * repository that write an OPERATIONS row. Both follow the same order, which is
 * the order every operator command in this codebase follows and the one §14 of
 * the operator brief insists on:
 *
 * resolve the operator → check the capability → do the thing → record what
 * happened, including when it did not happen.
 *
 * Nothing here reports success optimistically. A control write answers with the
 * control that actually stands afterwards — the one it wrote on success, and
 * the one somebody else wrote on a conflict — so a console never has to guess
 * and an operator never presses a switch twice because the screen did not say
 * whether the first press took.
 */

const maximumWindowHours = 24 * 30;
const defaultWindowHours = 24 * 7;

/** How far back an audit read looks, from a bounded query value. */
function windowFrom(query: URLSearchParams, now: Date): Date | undefined {
  const raw = query.get('hours');
  if (raw === null) {
    return new Date(now.getTime() - defaultWindowHours * 3_600_000);
  }
  if (!/^[1-9][0-9]{0,3}$/u.test(raw)) return undefined;
  const hours = Number.parseInt(raw, 10);
  if (hours > maximumWindowHours) return undefined;
  return new Date(now.getTime() - hours * 3_600_000);
}

function decodeActionCursor(
  value: string,
): { readonly id: string; readonly occurredAt: Date } | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null) return undefined;
  const { i: id, t: at } = decoded as {
    readonly i?: unknown;
    readonly t?: unknown;
  };
  if (typeof id !== 'string' || typeof at !== 'string') return undefined;
  const occurredAt = new Date(at);
  if (Number.isNaN(occurredAt.getTime())) return undefined;
  return { id, occurredAt };
}

function encodeActionCursor(input: {
  readonly id: string;
  readonly occurredAt: Date;
}): string {
  return Buffer.from(
    JSON.stringify({ i: input.id, t: input.occurredAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}

function decodeGrantCursor(
  value: string,
): { readonly grantedAt: Date; readonly id: string } | undefined {
  const decoded = decodeActionCursor(value);
  if (decoded === undefined) return undefined;
  return { grantedAt: decoded.occurredAt, id: decoded.id };
}

export interface AdminOperatorRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly environment: string;
  readonly now: () => Date;
  readonly operations: OperationsService;
}

export class AdminOperatorRoutes {
  constructor(private readonly dependencies: AdminOperatorRoutesDependencies) {}

  /**
   * What the caller may do.
   *
   * The one operator route that requires no capability, because it is how the
   * console learns what to render. It reports only the caller's own standing,
   * which is nothing they could not learn by pressing every button.
   */
  async getOperator(input: RouteRequest): Promise<RouteResult> {
    const resolved =
      await this.dependencies.adminContext.resolveStanding(input);
    if ('failure' in resolved) return resolved.failure;
    return {
      body: adminOperatorResponseSchema.parse({
        capabilities: [...resolved.context.capabilities],
        environment: this.dependencies.environment,
        ...(resolved.context.role === undefined
          ? {}
          : { role: resolved.context.role }),
        source: resolved.context.standingSource,
      }),
      status: 200,
    };
  }

  async listOperators(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operators.manage',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query);
    if (size === undefined) return this.invalid(input);
    const rawCursor = query.get('cursor');
    const cursor =
      rawCursor === null ? undefined : decodeGrantCursor(rawCursor);
    if (rawCursor !== null && cursor === undefined) return this.invalid(input);

    const rows = await this.dependencies.operations.grants({
      ...(cursor === undefined ? {} : { cursor }),
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      body: adminOperatorListResponseSchema.parse({
        // The catalogue travels with the list so a console never hard-codes
        // what a role means, and so an operator granting one can see what they
        // are handing over before they hand it over.
        catalogue: operatorRoles.map((role) => ({
          capabilities: [...capabilitiesOfRole(role)],
          role,
        })),
        grants: page.map((row) => ({
          grantedAt: row.grantedAt.toISOString(),
          ...(row.grantedBy === null ? {} : { grantedBy: row.grantedBy }),
          id: row.id,
          reason: row.reason,
          ...(row.revokedAt === null
            ? {}
            : { revokedAt: row.revokedAt.toISOString() }),
          role: row.role,
          subjectReference: row.subjectReference,
        })),
        ...(rows.length > size && last !== undefined
          ? {
              nextCursor: encodeActionCursor({
                id: last.id,
                occurredAt: last.grantedAt,
              }),
            }
          : {}),
      }),
      status: 200,
    };
  }

  /**
   * Grants a role, or revokes whatever the operator held.
   *
   * One route for both, because they are the same decision about the same
   * person and splitting them would let a console revoke without a reason.
   */
  async setOperatorRole(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operators.manage',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adminOperatorRoleRequestSchema, input.body);
    if (!parsed.ok) {
      return this.refusedAction(input, resolved.context, {
        action: 'operator.role.granted',
        capability: 'operators.manage',
        failureCode: productErrorCodes.validationFailed,
        reason: 'operator role request failed validation',
        status: 422,
        subjectType: 'operator',
      });
    }

    const { reason, role, subjectReference } = parsed.value;
    const previous =
      await this.dependencies.operations.grantedRoleOf(subjectReference);
    const outcome =
      role === undefined
        ? await this.dependencies.operations.revokeRole({
            actorReference: resolved.context.actorReference,
            subjectReference,
          })
        : await this.dependencies.operations.grantRole({
            actorReference: resolved.context.actorReference,
            reason,
            role,
            subjectReference,
          });

    await this.dependencies.operations.recordAction({
      action:
        role === undefined ? 'operator.role.revoked' : 'operator.role.granted',
      actorReference: resolved.context.actorReference,
      capability: 'operators.manage',
      correlationId: input.correlationId,
      outcome: outcome.kind === 'unchanged' ? 'refused' : 'applied',
      // `unchanged` means there was nothing to change — a revocation of an
      // operator who held nothing. Not a conflict: nobody raced anybody.
      ...(outcome.kind === 'unchanged'
        ? { failureCode: productErrorCodes.notFound }
        : {}),
      ...(previous === undefined ? {} : { previousState: previous }),
      reason,
      ...(role === undefined ? {} : { requestedState: role }),
      subjectId: subjectReference,
      subjectType: 'operator',
    });

    return {
      body: adminOperatorRoleResponseSchema.parse({
        ...(outcome.kind === 'unchanged'
          ? {}
          : {
              grant: {
                grantedAt: outcome.grant.grantedAt.toISOString(),
                ...(outcome.grant.grantedBy === null
                  ? {}
                  : { grantedBy: outcome.grant.grantedBy }),
                id: outcome.grant.id,
                reason: outcome.grant.reason,
                ...(outcome.grant.revokedAt === null
                  ? {}
                  : { revokedAt: outcome.grant.revokedAt.toISOString() }),
                role: outcome.grant.role,
                subjectReference: outcome.grant.subjectReference,
              },
            }),
        outcome: outcome.kind,
      }),
      status: 200,
    };
  }

  async listControls(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'config.read',
    );
    if ('failure' in resolved) return resolved.failure;
    const controls = await this.dependencies.operations.controls();
    return {
      body: adminControlListResponseSchema.parse({
        controls: controls.map((control) => this.controlBody(control)),
        propagationMilliseconds:
          this.dependencies.operations.controlPropagationMilliseconds,
      }),
      status: 200,
    };
  }

  async setControl(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'config.write',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adminControlRequestSchema, input.body);
    if (!parsed.ok) {
      return this.refusedAction(input, resolved.context, {
        action: 'control.set',
        capability: 'config.write',
        failureCode: productErrorCodes.validationFailed,
        reason: 'control request failed validation',
        status: 422,
        subjectType: 'control',
      });
    }

    const { enabled, expectedVersion, key, reason } = parsed.value;
    const before = (await this.dependencies.operations.controls()).find(
      (control) => control.key === key,
    );
    const outcome = await this.dependencies.operations.setControl({
      actorReference: resolved.context.actorReference,
      enabled,
      expectedVersion,
      key,
      reason,
    });

    await this.dependencies.operations.recordAction({
      action: 'control.set',
      actorReference: resolved.context.actorReference,
      capability: 'config.write',
      correlationId: input.correlationId,
      ...(outcome.kind === 'conflict'
        ? { failureCode: productErrorCodes.conflict }
        : {}),
      outcome: outcome.kind === 'applied' ? 'applied' : 'refused',
      ...(before === undefined
        ? {}
        : { previousState: before.enabled ? 'enabled' : 'disabled' }),
      reason,
      requestedState: enabled ? 'enabled' : 'disabled',
      subjectId: key,
      subjectType: 'control',
    });

    return {
      body: adminControlResponseSchema.parse({
        control: this.controlBody(outcome.control),
        outcome: outcome.kind,
        propagationMilliseconds:
          this.dependencies.operations.controlPropagationMilliseconds,
      }),
      status: 200,
    };
  }

  async listActions(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'audit.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const size = this.pageSize(query);
    if (size === undefined) return this.invalid(input);
    const since = windowFrom(query, this.dependencies.now());
    if (since === undefined) return this.invalid(input);

    const rawAction = query.get('action');
    if (
      rawAction !== null &&
      !operatorActionNames.includes(rawAction as OperatorActionName)
    ) {
      return this.invalid(input);
    }
    const rawOutcome = query.get('outcome');
    if (
      rawOutcome !== null &&
      !operatorActionOutcomes.includes(rawOutcome as OperatorActionOutcome)
    ) {
      return this.invalid(input);
    }
    const rawCursor = query.get('cursor');
    const cursor =
      rawCursor === null ? undefined : decodeActionCursor(rawCursor);
    if (rawCursor !== null && cursor === undefined) return this.invalid(input);
    const actor = query.get('actor');
    const subjectId = query.get('subjectId');

    const rows = await this.dependencies.operations.actions({
      ...(rawAction === null
        ? {}
        : { action: rawAction as OperatorActionName }),
      ...(actor === null ? {} : { actorReference: actor }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: size + 1,
      ...(rawOutcome === null
        ? {}
        : { outcome: rawOutcome as OperatorActionOutcome }),
      since,
      ...(subjectId === null ? {} : { subjectId }),
    });
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      body: adminOperatorActionListResponseSchema.parse({
        actions: page.map((row) => ({
          action: row.action,
          actorReference: row.actorReference,
          capability: row.capability,
          ...(row.correlationId === null
            ? {}
            : { correlationId: row.correlationId }),
          ...(row.failureCode === null ? {} : { failureCode: row.failureCode }),
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          outcome: row.outcome,
          ...(row.previousState === null
            ? {}
            : { previousState: row.previousState }),
          reason: row.reason,
          ...(row.requestedState === null
            ? {}
            : { requestedState: row.requestedState }),
          ...(row.subjectId === null ? {} : { subjectId: row.subjectId }),
          subjectType: row.subjectType,
        })),
        ...(rows.length > size && last !== undefined
          ? { nextCursor: encodeActionCursor(last) }
          : {}),
        since: since.toISOString(),
      }),
      status: 200,
    };
  }

  private controlBody(control: {
    readonly changedBy: string | undefined;
    readonly enabled: boolean;
    readonly key: string;
    readonly reason: string | undefined;
    readonly updatedAt: Date | undefined;
    readonly version: number;
  }) {
    const declared = operationalControls.find(
      (entry) => entry.key === control.key,
    );
    return {
      ...(control.changedBy === undefined
        ? {}
        : { changedBy: control.changedBy }),
      enabled: control.enabled,
      key: control.key,
      ...(control.reason === undefined ? {} : { reason: control.reason }),
      // The summary comes from the policy rather than the row, so the words
      // describing what a switch does cannot drift from what it actually does.
      summary: declared?.summary ?? control.key,
      ...(control.updatedAt === undefined
        ? {}
        : { updatedAt: control.updatedAt.toISOString() }),
      version: control.version,
    };
  }

  private pageSize(query: URLSearchParams): number | undefined {
    const raw = query.get('pageSize');
    if (raw === null) return defaultPageSize;
    const parsed = pageSizeSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * Refuses a command and records that it was refused.
   *
   * A malformed command is still an operator trying to change something, and an
   * audit that only recorded well-formed attempts would be missing exactly the
   * ones worth asking about.
   */
  private async refusedAction(
    input: RouteRequest,
    context: AdminContext,
    detail: {
      readonly action: OperatorActionName;
      readonly capability: 'config.write' | 'operators.manage';
      readonly failureCode: string;
      readonly reason: string;
      readonly status: number;
      readonly subjectType: 'control' | 'operator';
    },
  ): Promise<RouteResult> {
    await this.dependencies.operations.recordAction({
      action: detail.action,
      actorReference: context.actorReference,
      capability: detail.capability,
      correlationId: input.correlationId,
      failureCode: detail.failureCode,
      outcome: 'refused',
      reason: detail.reason,
      subjectType: detail.subjectType,
    });
    return routeFailure(detail.status, detail.failureCode, input.correlationId);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}

/** Keeps the role vocabulary honest at the type level for the catalogue above. */
export type { OperatorRole };
