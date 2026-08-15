import { z } from 'zod';

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

/** ISO 4217 alpha-3, upper case. Restated for database CHECK constraints. */
export const currencyCodePattern = '^[A-Z]{3}$';

/**
 * How many decimal places one unit of a currency divides into, per ISO 4217.
 *
 * This is the table that stops "all money has two decimals" from becoming a
 * silent factor-of-one-hundred error. A yen has no minor unit at all and a
 * dinar has three, so a minor-unit integer means nothing without its exponent.
 *
 * Membership here makes a currency *representable*, not *available*. Adding a
 * row is a statement about arithmetic; enabling commerce in that currency is a
 * separate approved decision.
 */
export const currencyMinorUnitExponents = {
  AED: 2,
  AUD: 2,
  BHD: 3,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CLP: 0,
  CNY: 2,
  COP: 2,
  CZK: 2,
  DKK: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  MXN: 2,
  MYR: 2,
  NOK: 2,
  NZD: 2,
  OMR: 3,
  PHP: 2,
  PLN: 2,
  RON: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TND: 3,
  TRY: 2,
  TWD: 2,
  USD: 2,
  VND: 0,
  ZAR: 2,
} as const satisfies Readonly<Record<string, number>>;

export type CurrencyCode = keyof typeof currencyMinorUnitExponents;

export const currencyCodes = Object.keys(
  currencyMinorUnitExponents,
).sort() as readonly CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(currencyMinorUnitExponents, value);
}

/**
 * The exponent for a currency, or a refusal.
 *
 * It throws rather than defaulting. A default here would be the one behaviour
 * that turns an unknown currency into a plausible-looking wrong amount.
 */
export function currencyMinorUnitExponent(currency: string): number {
  if (!isCurrencyCode(currency)) {
    throw new Error(`No minor-unit metadata for currency ${currency}`);
  }
  return currencyMinorUnitExponents[currency];
}

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

export const moneySchema = z
  .object({
    amountMinor: minorUnitsSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type MoneyValue = z.infer<typeof moneySchema>;

/**
 * Renders minor units as a decimal string for display, exactly.
 *
 * Digit manipulation rather than division, because dividing by `10 ** exponent`
 * reintroduces the floating point the representation exists to avoid. The
 * output carries no currency symbol, no grouping, and no locale: those are a
 * presentation decision belonging to whichever surface renders it, and guessing
 * one here would put a formatting opinion inside the contract package.
 */
export function formatMinorUnits(
  amountMinor: string,
  currency: string,
): string {
  const exponent = currencyMinorUnitExponent(currency);
  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(
    exponent + 1,
    '0',
  );
  const whole = digits.slice(0, digits.length - exponent);
  const fraction =
    exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}
