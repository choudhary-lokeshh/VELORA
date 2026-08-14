import { z } from 'zod';

/**
 * Wire vocabulary shared by every consumer product domain.
 *
 * AUTH keeps its own codes because its rejections must stay deliberately
 * uninformative about accounts and credentials. Product domains have a
 * different obligation: a caller must be able to tell "you may not do this"
 * from "that no longer exists" from "your input was wrong", without ever
 * learning anything about another user. These codes draw exactly that line.
 */
export const productErrorCodes = {
  /** The action is not permitted for this caller, target, or current state. */
  actionNotPermitted: 'ACTION_NOT_PERMITTED',
  /** The caller's consumer account is not in a state that allows this. */
  accountNotEligible: 'ACCOUNT_NOT_ELIGIBLE',
  /** A concurrent change won; the caller should re-read and decide again. */
  conflict: 'STATE_CONFLICT',
  /** A required external capability is not available in this environment. */
  dependencyUnavailable: 'DEPENDENCY_UNAVAILABLE',
  /** The operation requires a Consumer Web or Consumer Mobile audience. */
  consumerSurfaceRequired: 'CONSUMER_SURFACE_REQUIRED',
  /** The same idempotency key was reused with different input. */
  idempotencyMismatch: 'IDEMPOTENCY_KEY_MISMATCH',
  /** A bounded per-account collection is already full. */
  limitReached: 'LIMIT_REACHED',
  /** Privacy-safe not found. It never distinguishes absent from unauthorized. */
  notFound: 'RESOURCE_NOT_FOUND',
  rateLimited: 'RATE_LIMITED',
  validationFailed: 'VALIDATION_FAILED',
} as const;
export type ProductErrorCode =
  (typeof productErrorCodes)[keyof typeof productErrorCodes];

/**
 * Client-supplied idempotency key. Bounded and opaque, scoped by the server to
 * the acting account and the operation, per
 * `docs/engineering/03-jobs-idempotency-concurrency.md`.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/u);

/** Contract header carrying {@link idempotencyKeySchema}. */
export const idempotencyHeader = 'x-velora-idempotency-key';

/**
 * Opaque forward-only pagination cursor. Clients echo it back verbatim; the
 * server signs and validates it, so a tampered value is a validation failure
 * rather than a different query.
 */
export const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._-]+$/u);

/**
 * Which conversation a paged read addresses. A published query parameter rather
 * than a path segment, so the whole query surface stays inside one registry the
 * contract test can check for credential-shaped inputs.
 */
export const conversationIdSchema = z.uuid();

export const pageSizeSchema = z.coerce.number().int().min(1).max(50);

/** Default page size when a caller supplies none. */
export const defaultPageSize = 20;

/**
 * Largest consumer product request body accepted. Larger than an AUTH body,
 * because a message or a profile carries real text, and far below the global
 * ceiling so oversized input is still rejected cheaply.
 */
export const maximumProductRequestBodyBytes = 32_768;
