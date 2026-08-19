import {
  adminExactActionAuthorizationHeader,
  adminExactActionAuthorizationIdSchema,
  adminIdentityStateResponseSchema,
  adminIdentitySubjectQuerySchema,
  adminIdentitySubjectResponseSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  bindHighImpactAction,
  type HighImpactBinding,
  type HighImpactExecutionResult,
} from '../auth/privileged.js';
import type { AuthContext } from '../auth/context.js';
import {
  contractHeader,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type {
  IdentityOperations,
  IdentitySubjectOperationsView,
} from '../identity/operations.js';
import type { AdminContextResolver } from './context.js';

/** AUTH's narrow exact-action execution seam; it never grants Admin access. */
export interface AdminExactActionPort {
  executeHighImpact(input: {
    readonly authorizationId: string;
    readonly binding: HighImpactBinding;
    readonly correlationId: string;
    readonly context: AuthContext;
    readonly currentStateDigest: string;
  }): Promise<HighImpactExecutionResult>;
}

export interface AdminIdentityRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  /** Omitted only in isolated tests that do not exercise this sensitive read. */
  readonly exactActions?: AdminExactActionPort;
  /** IDENTITY's published operations projection, never its database/repository. */
  readonly identity: IdentityOperations;
}

/**
 * Read-only Identity Assurance operations.
 *
 * The aggregate view carries counts and names only. The subject view is not a
 * directory: its caller supplies an already-known opaque owner reference, a
 * one-time AUTH exact-action authorization binds that exact target, and no
 * endpoint here can search, list, export, change, or repair Identity truth.
 */
export class AdminIdentityRoutes {
  constructor(private readonly dependencies: AdminIdentityRoutesDependencies) {}

  async getIdentityState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;

    const state = await this.dependencies.identity.operationalState();
    return {
      body: adminIdentityStateResponseSchema.parse(state),
      status: 200,
    };
  }

  async getIdentitySubject(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;

    const query = subjectQuery(input.request);
    const authorization = adminExactActionAuthorizationIdSchema.safeParse(
      contractHeader(input.request, adminExactActionAuthorizationHeader) ?? '',
    );
    if (query === undefined || !authorization.success)
      return this.invalid(input);

    const binding = bindSubjectRead(query);
    const executed =
      this.dependencies.exactActions === undefined
        ? {
            kind: 'rejected' as const,
            reason: 'unknown_authorization' as const,
          }
        : await this.dependencies.exactActions.executeHighImpact({
            authorizationId: authorization.data,
            binding,
            correlationId: input.correlationId,
            context: resolved.context.auth,
            // A sensitive read has no mutable business effect to pin. Its
            // exact owner target is the durable precondition, and the action
            // record still rechecks session liveness and fresh assurance.
            currentStateDigest: binding.beforeStateDigest,
          });
    if (executed.kind !== 'executed') {
      return routeFailure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }

    const subject = await this.dependencies.identity.subjectDetail(query);
    if (subject === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: adminIdentitySubjectResponseSchema.parse({
        subject: subjectBody(subject),
      }),
      status: 200,
    };
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}

function subjectQuery(request: Request):
  | {
      readonly ownerDomain: 'auth' | 'creators' | 'safety';
      readonly ownerReference: string;
    }
  | undefined {
  const parameters = new URL(request.url).searchParams;
  // `URLSearchParams.get()` alone would hide duplicate keys. This operation's
  // authority must be exactly the pair AUTH bound, not a parser's arbitrary
  // choice among repeated values or additional future filters.
  if (
    [...parameters].length !== 2 ||
    parameters.getAll('ownerDomain').length !== 1 ||
    parameters.getAll('ownerReference').length !== 1
  ) {
    return undefined;
  }
  const parsed = adminIdentitySubjectQuerySchema.safeParse({
    ownerDomain: parameters.get('ownerDomain'),
    ownerReference: parameters.get('ownerReference'),
  });
  return parsed.success ? parsed.data : undefined;
}

function bindSubjectRead(input: {
  readonly ownerDomain: 'auth' | 'creators' | 'safety';
  readonly ownerReference: string;
}): HighImpactBinding {
  const target = {
    ownerDomain: input.ownerDomain,
    ownerReference: input.ownerReference,
  };
  return bindHighImpactAction({
    argumentsValue: target,
    // The exact reference is the read's stable state. Binding the response
    // would require disclosing it before authorization, while a read changes
    // no owner truth whose version must be protected against a race.
    beforeState: target,
    expectedEffect: { kind: 'identity_subject_read' },
    operation: 'identity.read_subject',
    targetId: `${input.ownerDomain}:${input.ownerReference}`,
    targetType: 'identity_subject',
  });
}

function subjectBody(subject: IdentitySubjectOperationsView) {
  return {
    attempts: subject.attempts.map((attempt) => ({
      createdAt: attempt.createdAt.toISOString(),
      purpose: attempt.purpose,
      state: attempt.state,
      updatedAt: attempt.updatedAt.toISOString(),
    })),
    attemptsTruncated: subject.attemptsTruncated,
    currentEvidence: subject.currentEvidence.map((evidence) => ({
      evidenceClass: evidence.evidenceClass,
      ...(evidence.expiresAt === undefined
        ? {}
        : { expiresAt: evidence.expiresAt.toISOString() }),
      recordedAt: evidence.recordedAt.toISOString(),
      result: evidence.result,
    })),
    findings: subject.findings.map((finding) => ({
      detectedAt: finding.detectedAt.toISOString(),
      kind: finding.kind,
      state: finding.state,
    })),
    findingsTruncated: subject.findingsTruncated,
    ownerDomain: subject.ownerDomain,
  };
}
