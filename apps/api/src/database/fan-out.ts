/**
 * Independent reads, run a few at a time rather than all at once.
 *
 * `docs/decisions/ADR-0019-database-connection-admission.md` sizes this
 * platform's pool at ten connections and admits eight requests at a time, on
 * the assumption that a request wants roughly one connection at a time. An
 * operator read that issues twenty independent queries with `Promise.all`
 * quietly breaks that assumption: it takes as many connections as the pool will
 * give it, and the admission bound — which counts requests, not queries —
 * cannot see it happening. What an operator observes is their own console being
 * fast; what everybody else observes is `503` from a platform that had capacity
 * a moment ago.
 *
 * That is not hypothetical here. The first browser run of the operator console
 * produced exactly it: `database admission saturated` at eight in-flight
 * requests while one screen was reading twenty-two tables at once.
 *
 * So the operator directories fan out through this instead. It is not a rate
 * limit and not a queue — it is the smallest possible statement that a single
 * read may hold a few connections rather than all of them.
 */

/**
 * How many of one read's queries may be in flight together.
 *
 * Three, which leaves the pool's spare capacity to the product even when
 * several operator screens are open. These reads are made by a handful of
 * people and are not on any hot path, so the cost of the bound is a few
 * milliseconds of a screen nobody is racing.
 */
export const operatorFanOut = 3;

/**
 * Runs every task, at most `limit` at a time, preserving input order in the
 * result.
 *
 * Deliberately takes thunks rather than promises: a promise passed in has
 * already started, which would make the bound decorative.
 *
 * The tuple overload exists so a caller running a handful of differently
 * shaped reads keeps each one's type on the way out, exactly as `Promise.all`
 * does. Without it every mixed fan-out would have to be widened and then
 * narrowed again by hand, which is where a wrong index goes unnoticed.
 */
export async function bounded<
  const T extends readonly (() => Promise<unknown>)[],
>(
  tasks: T,
  limit?: number,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
export async function bounded<T>(
  tasks: readonly (() => Promise<T>)[],
  limit?: number,
): Promise<T[]>;
export async function bounded<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number = operatorFanOut,
): Promise<T[]> {
  const results = Array.from<T>({ length: tasks.length });
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, tasks.length)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        const task = tasks[index];
        if (task === undefined) return;
        results[index] = await task();
      }
    },
  );
  await Promise.all(workers);
  return results;
}
