import { describe, expect, it } from 'vitest';

import { attempt, classify, isOk } from '../src/result.js';

/**
 * How a server answer becomes a product answer.
 *
 * These branches decide what every surface can say, so they are checked
 * exhaustively here rather than through a component.
 */

const response = (status: number) => ({ status });

describe('classifying an answer', () => {
  it('reports a body as success whatever the status carried it', () => {
    const result = classify({ data: { id: 'a' }, response: response(200) });
    expect(isOk(result)).toBe(true);
    expect(result).toEqual({ kind: 'ok', value: { id: 'a' } });
  });

  it('separates the one status a client may act on by itself', () => {
    expect(classify({ response: response(401) })).toEqual({
      kind: 'unauthenticated',
    });
  });

  it('keeps absent and not-visible indistinguishable', () => {
    // The API deliberately answers both with 404, and this layer must not
    // invent a difference the server refused to disclose.
    expect(classify({ response: response(404) })).toEqual({
      kind: 'not-found',
    });
  });

  it('passes a refusal through with the code the server chose', () => {
    expect(
      classify({
        error: { code: 'ACTION_NOT_PERMITTED' },
        response: response(409),
      }),
    ).toEqual({ code: 'ACTION_NOT_PERMITTED', kind: 'refused', status: 409 });
  });

  it('falls back to the status when a refusal carries no code', () => {
    expect(classify({ error: 'nonsense', response: response(422) })).toEqual({
      code: 'HTTP_422',
      kind: 'refused',
      status: 422,
    });
  });

  it('treats a missing capability as a statement, not an outage', () => {
    // 503 means "not configured here". Calling it unreachable would tell
    // somebody to try again at a provider that does not exist.
    expect(
      classify({
        error: { code: 'DEPENDENCY_UNAVAILABLE' },
        response: response(503),
      }),
    ).toEqual({
      code: 'DEPENDENCY_UNAVAILABLE',
      kind: 'refused',
      status: 503,
    });
  });

  it('treats a capacity refusal as retryable unavailability', () => {
    // The same status, the other code. The server declined to begin the work,
    // so nothing was decided about the caller and trying again is the answer —
    // reading it as a refusal would show somebody a decision nobody made.
    expect(
      classify({
        error: { code: 'SERVICE_UNAVAILABLE' },
        response: response(503),
      }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('treats a server failure as unavailable', () => {
    expect(classify({ response: response(500) })).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('attempting a call', () => {
  it('turns a transport failure into an unavailable answer', async () => {
    expect(
      await attempt(() => Promise.reject(new TypeError('network failed'))),
    ).toEqual({ kind: 'unavailable' });
  });

  it('turns an aborted call into an unavailable answer', async () => {
    // A superseded read has no answer to show, and reporting it as a refusal
    // would put a decision on screen that nobody made.
    expect(
      await attempt(() =>
        Promise.reject(new DOMException('aborted', 'AbortError')),
      ),
    ).toEqual({ kind: 'unavailable' });
  });

  it('passes a real answer through unchanged', async () => {
    expect(
      await attempt(() =>
        Promise.resolve({ data: 7, response: response(200) }),
      ),
    ).toEqual({ kind: 'ok', value: 7 });
  });
});
