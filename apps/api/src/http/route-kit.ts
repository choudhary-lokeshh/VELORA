import {
  apiErrorSchema,
  maximumProductRequestBodyBytes,
} from '@velora/validation';

/**
 * Mechanics every product route shares: one response shape, one generic error
 * body, and one body parser that refuses oversized or malformed input before a
 * handler sees it. Authorization is deliberately absent here — it belongs to
 * the owning domain, never to a transport helper.
 */

export interface RouteRequest {
  readonly body: string;
  readonly correlationId: string;
  /** Exact bytes, for provider callbacks whose signature authenticates bytes. */
  readonly rawBody: Uint8Array;
  readonly request: Request;
}

export interface RouteResult {
  readonly body: unknown;
  readonly cookies?: readonly string[];
  readonly status: number;
}

export function routeFailure(
  status: number,
  code: string,
  correlationId: string,
  cookies?: readonly string[],
): RouteResult {
  return {
    body: apiErrorSchema.parse({
      code,
      correlationId,
      // One generic message. The stable code tells a client what to do; the
      // message never carries state, policy, or another user's data.
      message: 'Request failed',
    }),
    ...(cookies === undefined ? {} : { cookies }),
    status,
  };
}

/**
 * Structural view of a contract schema, so the API validates with the published
 * schemas without taking a runtime dependency on the schema library that the
 * workspace dependency policy does not approve for it.
 */
export interface ContractSchema<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export function parseRouteBody<T>(
  schema: ContractSchema<T>,
  raw: string,
): { readonly ok: true; readonly value: T } | { readonly ok: false } {
  if (raw.length > maximumProductRequestBodyBytes) return { ok: false };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.length === 0 ? '{}' : raw);
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** Reads one bounded contract header, treating an empty value as absent. */
export function contractHeader(
  request: Request,
  name: string,
): string | undefined {
  const value = request.headers.get(name);
  return value === null || value.length === 0 ? undefined : value;
}
