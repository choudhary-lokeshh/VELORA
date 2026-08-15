import {
  creatorEarningsHistoryResponseSchema,
  creatorEarningsResponseSchema,
  currencyCodeSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  requireCreator,
  type CreatorContextResolver,
} from '../creators/context.js';
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { CommercePolicy } from './commerce-policy.js';
import { decodeOfferCursor, encodeOfferCursor } from './cursor.js';
import type {
  CreatorEarningsEntry,
  EarningsRepository,
} from './earnings-repository.js';
import { maximumReversalPageSize } from './reversal-policy.js';

/**
 * A creator's own money, read from what the platform actually holds.
 *
 * Everything on this surface is a fact about money that has already moved.
 * There is no forecast, no trend, no projection of future income, and no
 * conversion rate — none of those exist as platform truth, and a number with
 * nothing behind it is worse than an empty screen because somebody will plan
 * against it.
 *
 * Currencies are separate all the way out to the wire. A creator paid in euros
 * and yen gets two sets of figures and never a third that adds them up.
 *
 * Readiness travels with the balances for the same reason it travels with the
 * offer list: a creator is entitled to be told plainly that monetisation is not
 * enabled, rather than meeting an empty earnings screen that looks like a
 * failure of theirs.
 */

export interface EarningsRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly earnings: EarningsRepository;
  readonly policy: CommercePolicy;
}

function entryBody(entry: CreatorEarningsEntry) {
  return {
    amount: {
      amountMinor: entry.amount.amountMinor.toString(),
      currency: entry.amount.currency,
    },
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt.toISOString(),
    offerId: entry.offerId,
    state: entry.state,
  };
}

export class EarningsRoutes {
  constructor(private readonly dependencies: EarningsRoutesDependencies) {}

  /** Every currency this creator has earned in, with the figures for each. */
  async getEarnings(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const { earnings, policy } = this.dependencies;

    // One transaction for every figure, so a settlement landing between two
    // reads cannot produce a page where the parts disagree with the whole.
    const currencies = await earnings.transaction(async (executor) => {
      const codes = await earnings.currenciesFor(
        executor,
        resolved.context.creatorId,
      );
      return Promise.all(
        codes.map(async (currency) =>
          earnings.earningsFor(executor, {
            creatorId: resolved.context.creatorId,
            currency,
          }),
        ),
      ).then((rows) =>
        rows.map((row, index) => ({
          currency: codes[index] ?? '',
          disputed: row.disputed.amountMinor.toString(),
          gross: row.gross.amountMinor.toString(),
          payable: row.payable.amountMinor.toString(),
          platform: row.platform.amountMinor.toString(),
          reversed: row.reversed.amountMinor.toString(),
          tax: row.tax.amountMinor.toString(),
        })),
      );
    });

    return {
      body: creatorEarningsResponseSchema.parse({
        currencies,
        readiness: {
          currencies: policy.currencies(),
          enabled: policy.currencies().length > 0,
          intervals: policy.intervals,
          modes: policy.modes,
          source: policy.source,
        },
      }),
      status: 200,
    };
  }

  /** One currency's commercial history, newest first, keyset paged. */
  async getEarningsHistory(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    // The currency is required rather than defaulted. Defaulting would pick one
    // of a creator's currencies for them and show it as though it were all of
    // their money.
    const currency = currencyCodeSchema.safeParse(query.get('currency') ?? '');
    if (!currency.success) return this.invalid(input);
    const rawSize = query.get('pageSize');
    const size =
      rawSize === null ? defaultPageSize : pageSizeSchema.safeParse(rawSize);
    if (typeof size !== 'number' && !size.success) return this.invalid(input);
    const rawCursor = query.get('cursor');
    const after = rawCursor === null ? undefined : decodeOfferCursor(rawCursor);
    if (rawCursor !== null && after === undefined) return this.invalid(input);

    const limit = Math.min(
      typeof size === 'number' ? size : size.data,
      maximumReversalPageSize,
    );
    const entries = await this.dependencies.earnings.historyFor(
      this.dependencies.earnings.transactionless,
      {
        after,
        creatorId: resolved.context.creatorId,
        currency: currency.data,
        limit,
      },
    );
    // A full page implies there may be more; a short one is the end. The cursor
    // is the position of the last row rather than a count, so a row arriving
    // mid-read cannot shift a page boundary under the reader.
    const last = entries.at(-1);
    const nextCursor =
      entries.length === limit && last !== undefined
        ? encodeOfferCursor({ id: last.id, moment: last.occurredAt })
        : undefined;

    return {
      body: creatorEarningsHistoryResponseSchema.parse({
        currency: currency.data,
        entries: entries.map(entryBody),
        ...(nextCursor === undefined ? {} : { nextCursor }),
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
