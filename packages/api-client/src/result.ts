/**
 * What a product API call can answer, and nothing else.
 *
 * Deliberately exhaustive and deliberately coarse. A surface that renders these
 * cannot produce an infinite spinner, because every branch ends somewhere, and
 * it cannot swallow a failure, because there is no shape for one. `refused`
 * keeps the server's product code so a screen can say something true about
 * *this* refusal without inventing a reason for it.
 */
export type ApiResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  /** No live session. The only correct response is to authenticate again. */
  | { readonly kind: 'unauthenticated' }
  /** The server refused. `code` is its product code, never a guess. */
  | { readonly kind: 'refused'; readonly code: string; readonly status: number }
  /** Absent, or not visible to this caller. The two are indistinguishable. */
  | { readonly kind: 'not-found' }
  /** The request never got an answer, or the answer was a server failure. */
  | { readonly kind: 'unavailable' };

export function isOk<T>(
  result: ApiResult<T>,
): result is { readonly kind: 'ok'; readonly value: T } {
  return result.kind === 'ok';
}

function errorCode(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return fallback;
  }
  const { code }: { code: unknown } = error;
  return typeof code === 'string' ? code : fallback;
}

/**
 * Turns one transport answer into one product answer.
 *
 * It lives beside the generated client rather than inside one product client
 * because every surface needs the same reading of the same statuses, and a
 * second copy of these rules is a security defect waiting to diverge from this
 * one: the 503 distinction below and the refusal to interpret a refusal are
 * both decisions, not conveniences.
 *
 * A 401 is its own branch because it is the only status a client may act on by
 * itself. Everything else the server said is passed through as a refusal, and
 * this layer refuses to interpret why: `docs/domains/trust-safety.md` requires
 * a blocked pair to be indistinguishable from an absent one, so a client that
 * translated a refusal into "they blocked you" would be creating the disclosure
 * the API deliberately withheld.
 *
 * 503 is read by its code, because the contract uses that status for two
 * different things. `SERVICE_UNAVAILABLE` means the instance had no capacity to
 * begin the request: nothing was decided and nothing was written, so it is the
 * generic unavailable state a surface already offers a retry for. Every other
 * 503 says a required external capability is not configured in this
 * environment, which is a refusal — folding that one into "could not be
 * reached" would tell somebody to try again at a provider that does not exist.
 */
export function classify<T>(result: {
  readonly data?: T | undefined;
  readonly error?: unknown;
  readonly response: { readonly status: number };
}): ApiResult<T> {
  if (result.data !== undefined) return { kind: 'ok', value: result.data };
  const { status } = result.response;
  if (status === 401) return { kind: 'unauthenticated' };
  if (status === 404) return { kind: 'not-found' };
  const code = errorCode(result.error, `HTTP_${String(status)}`);
  // The server's own code, spelled here rather than imported: this package
  // depends on the generated document, not on the API's runtime schemas.
  if (status === 503 && code === 'SERVICE_UNAVAILABLE') {
    return { kind: 'unavailable' };
  }
  if ((status >= 400 && status < 500) || status === 503) {
    return { code, kind: 'refused', status };
  }
  return { kind: 'unavailable' };
}

/**
 * A transport failure is not an answer.
 *
 * It is reported as `unavailable` so the surface can offer a retry, rather than
 * as a refusal somebody would read as a decision made about them. An aborted
 * request lands here too, which is correct: a superseded read has no answer to
 * show.
 */
export async function attempt<T>(
  work: () => Promise<{
    data?: T | undefined;
    error?: unknown;
    response: { status: number };
  }>,
): Promise<ApiResult<T>> {
  try {
    return classify(await work());
  } catch {
    return { kind: 'unavailable' };
  }
}
