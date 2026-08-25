import type { ApiResult } from './result.js';

/**
 * The book of addresses a surface has been granted, and how it keeps them
 * current.
 *
 * Every projection carries image references rather than URLs, so every surface
 * that renders a person has the same three problems: it holds references, it
 * needs addresses, and the addresses stop working. Solving that once here keeps
 * the answer identical on Web and on Mobile, which matters because getting it
 * subtly different is how one surface ends up showing a photograph the other
 * has already stopped showing.
 *
 * It is deliberately framework-free, and it lives beside the generated client
 * rather than inside one product client because every surface that renders an
 * image needs it — a consumer looking at a person, and a browser looking at a
 * creator's public page through the creator client. `packages/design-tokens`
 * may not hold components and there is no approved shared component package, so
 * what is shared is the part that is genuinely not visual: the batching, the
 * cache, and the expiry rule. Each surface binds it to its own rendering.
 *
 * ## What it does not do
 *
 * It never persists. An address is a bearer credential with a short life, and
 * writing one to storage would mean a credential surviving a sign-out, a device
 * hand-off, or the authorization that produced it. The cache lives as long as
 * the object does.
 *
 * It never retries an absent reference on its own. A reference the server
 * declined to serve is remembered as declined until the caller asks again after
 * {@link declinedRetryMilliseconds}, so a list of forty people does not become
 * forty requests per render for the ones nobody may see.
 */

/**
 * How long before an address expires it is treated as already gone.
 *
 * An image request that starts one second before expiry can easily arrive
 * after it. The margin is what stops a surface rendering a frame that is
 * guaranteed to fail, and it is generous rather than tight because the cost of
 * asking again is one batched request.
 */
const expiryMarginMilliseconds = 30_000;

/**
 * How long a refusal is remembered.
 *
 * Short enough that granting access — an introduction becoming mutual, a block
 * being lifted — shows up without a reload, and long enough that a screenful of
 * people nobody may see does not re-ask on every render.
 */
const declinedRetryMilliseconds = 60_000;

/**
 * The shortest time an address is ever held, whatever its stated expiry.
 *
 * The expiry is a server instant compared against a device clock, and the two
 * are not the same clock. A device running far enough ahead would compute a
 * lifetime in the past for every grant it is given, discard each one on arrival,
 * and ask again on the next render — a request loop caused entirely by a wrong
 * clock. Holding briefly instead degrades that to images refreshing more often
 * than they need to, which is a visible inefficiency rather than a hidden one.
 */
const minimumHoldMilliseconds = 10_000;

/** The contract bound, so a caller never has to know it. */
const maximumBatch = 24;

/** When an address stops being used, given what the server said about it. */
function holdUntil(expiresAt: string | undefined, at: number): number {
  // A public address changes when its content does, so it never stops being
  // correct. Held for the life of this object, because the object is the
  // lifetime and nothing here is written down.
  if (expiresAt === undefined) return Number.POSITIVE_INFINITY;
  const stated = Date.parse(expiresAt) - expiryMarginMilliseconds;
  return Math.max(stated, at + minimumHoldMilliseconds);
}

interface CacheEntry {
  /** Absent for a refusal. */
  readonly url?: string;
  /** When this entry stops being usable, in epoch milliseconds. */
  readonly until: number;
}

/**
 * The one call this needs, supplied by whichever product client holds it.
 *
 * A function rather than a client, so this module names no product API and
 * neither product client has to know about the other. The variant is the
 * caller's own literal type; nothing here interprets it.
 */
export type MediaDeliveryExchange<TVariant extends string> = (input: {
  readonly assetIds: readonly string[];
  readonly variant: TVariant;
}) => Promise<
  ApiResult<{
    readonly deliveries: readonly {
      readonly assetId: string;
      readonly expiresAt?: string | undefined;
      readonly url: string;
    }[];
  }>
>;

export interface MediaAddressBook<TVariant extends string = string> {
  /**
   * Addresses for whichever of these references are currently servable.
   *
   * References with no entry in the answer are ones this person may not be
   * shown; a caller renders its fallback for those rather than treating it as
   * an error, because it is not one.
   */
  resolve(
    references: readonly string[],
    variant: TVariant,
  ): Promise<ReadonlyMap<string, string>>;
  /**
   * Whether the platform itself said it cannot deliver anything here.
   *
   * The one distinction worth publishing. A reference that was declined says
   * nothing about anybody and must stay unexplained, but an environment with no
   * approved delivery provider is a fact about the platform — and a surface
   * that could not tell the two apart would either accuse the viewer of
   * something or leave somebody staring at a photograph that is never coming.
   * It reflects the most recent exchange and is false until one has happened.
   */
  deliveryUnavailable(): boolean;
  /** Drops everything, for a sign-out. */
  clear(): void;
}

/** The code the API answers with when no delivery provider is configured. */
const dependencyUnavailable = 'DEPENDENCY_UNAVAILABLE';

export function createMediaAddressBook<TVariant extends string>(input: {
  readonly exchange: MediaDeliveryExchange<TVariant>;
  /** Injectable so a test does not depend on the wall clock. */
  readonly now?: () => number;
}): MediaAddressBook<TVariant> {
  const now = input.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<void>>();
  let unavailable = false;

  const keyOf = (reference: string, variant: TVariant) =>
    `${variant}:${reference}`;

  const live = (key: string): CacheEntry | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.until > now()) return entry;
    entries.delete(key);
    return undefined;
  };

  /**
   * One batch, recorded whether it succeeded, refused, or was declined.
   *
   * Deliberately not cancellable. A batch is shared: two components asking for
   * the same person in the same frame wait on one request, and one of them
   * unmounting must not cancel the work the other is still waiting for. A
   * caller that no longer wants the answer ignores it — the cache keeps what
   * arrived, so the next render is served from memory rather than asking again.
   */
  const fetchBatch = async (
    references: readonly string[],
    variant: TVariant,
  ): Promise<void> => {
    const result = await input.exchange({ assetIds: references, variant });
    if (result.kind !== 'ok') {
      unavailable =
        result.kind === 'refused' && result.code === dependencyUnavailable;
      // A failure is not a refusal of any particular image. Nothing is cached,
      // so the next render asks again — which is what a surface wants when the
      // platform was briefly unreachable, and harmless when it has no delivery
      // provider at all, because the flag above already says so.
      return;
    }
    unavailable = false;
    const granted = new Map(
      result.value.deliveries.map((delivery) => [delivery.assetId, delivery]),
    );
    const at = now();
    for (const reference of references) {
      const delivery = granted.get(reference);
      if (delivery === undefined) {
        entries.set(keyOf(reference, variant), {
          until: at + declinedRetryMilliseconds,
        });
        continue;
      }
      entries.set(keyOf(reference, variant), {
        until: holdUntil(delivery.expiresAt, at),
        url: delivery.url,
      });
    }
  };

  return {
    clear: () => {
      entries.clear();
      inFlight.clear();
      unavailable = false;
    },

    deliveryUnavailable: () => unavailable,

    resolve: async (references, variant) => {
      const wanted = [...new Set(references)];
      const missing = wanted.filter(
        (reference) => live(keyOf(reference, variant)) === undefined,
      );

      // A reference already being fetched is awaited rather than fetched again.
      // Two components rendering the same person in the same frame is the
      // normal case, not the exception.
      const pending = new Set<Promise<void>>();
      const toRequest: string[] = [];
      for (const reference of missing) {
        const key = keyOf(reference, variant);
        const existing = inFlight.get(key);
        if (existing === undefined) toRequest.push(reference);
        else pending.add(existing);
      }

      for (let index = 0; index < toRequest.length; index += maximumBatch) {
        const batch = toRequest.slice(index, index + maximumBatch);
        const work = fetchBatch(batch, variant).finally(() => {
          for (const reference of batch) {
            inFlight.delete(keyOf(reference, variant));
          }
        });
        for (const reference of batch) {
          inFlight.set(keyOf(reference, variant), work);
        }
        pending.add(work);
      }
      await Promise.all([...pending]);

      const resolved = new Map<string, string>();
      for (const reference of wanted) {
        const url = live(keyOf(reference, variant))?.url;
        if (url !== undefined) resolved.set(reference, url);
      }
      return resolved;
    },
  };
}
