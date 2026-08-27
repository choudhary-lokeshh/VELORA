import { z } from 'zod';

import {
  currencyCodes,
  currencyMinorUnitExponent,
  currencyMinorUnitExponents,
  currencyCodePattern,
  formatMinorUnits,
  isCurrencyCode,
  type CurrencyCode,
} from './money-bounds.js';

export {
  currencyCodePattern,
  currencyCodes,
  currencyMinorUnitExponent,
  currencyMinorUnitExponents,
  formatMinorUnits,
  isCurrencyCode,
  type CurrencyCode,
};

/**
 * Money on the wire, and the currency facts that make an amount readable.
 *
 * [ADR-0011](../../../docs/decisions/ADR-0011-payments-payouts.md) locks the
 * representation: a signed integer count of minor units together with an ISO
 * 4217 currency, never floating point. [ADR-0021](../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * adds the rule that the two travel as one value, because an amount that has
 * been separated from its currency is a number somebody will eventually add to
 * a different one.
 *
 * The amount crosses the wire as a decimal *string*. JSON has one numeric type
 * and it is a double, so `9007199254740993` does not survive a round trip
 * through `JSON.parse`. A string does, and it forces every consumer to decide
 * deliberately what to parse it into.
 *
 * Nothing here says an amount may be charged. The exponents below are
 * arithmetic facts about currencies; which currencies Velora may actually
 * transact in is commercial policy, is unresolved in
 * [DECISIONS_REQUIRED](../../../docs/decisions/DECISIONS_REQUIRED.md), and is
 * decided elsewhere by configuration that refuses in every deployed
 * environment.
 */

export const currencyCodeSchema = z.enum(
  currencyCodes as [CurrencyCode, ...CurrencyCode[]],
);

/**
 * A signed integer count of minor units, as a canonical decimal string.
 *
 * Canonical means no leading zeroes, no leading `+`, and no `-0`, so one amount
 * has exactly one spelling and two records of the same amount compare equal as
 * text. Nineteen digits is the widest value PostgreSQL `bigint` holds, which is
 * the storage this ultimately lands in.
 */
export const minorUnitsSchema = z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/u);

/**
 * A strictly positive count of minor units.
 *
 * A price, a charge, a refund amount, and a payout are all quantities that
 * cannot be zero or negative — the direction of a movement is carried by what
 * the operation is, never by the sign of its amount. Refusing it at the
 * contract boundary means a negative price is a validation failure rather than
 * something a policy bound has to catch downstream.
 */
export const positiveMinorUnitsSchema = z.string().regex(/^[1-9][0-9]{0,18}$/u);

export const moneySchema = z
  .object({
    amountMinor: minorUnitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type MoneyValue = z.infer<typeof moneySchema>;
