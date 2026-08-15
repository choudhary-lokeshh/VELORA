import {
  currencyMinorUnitExponent,
  isCurrencyCode,
  type CurrencyCode,
} from '@velora/validation';

import {
  maximumStorableMinorUnits,
  minimumStorableMinorUnits,
} from './policy.js';

/**
 * The authoritative money value.
 *
 * An amount and its currency, together, always. Every rule in
 * [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * about money follows from that pairing: two amounts can only be compared or
 * combined when their currencies agree, and there is no operation on this type
 * that produces a bare number somebody could later attach a different currency
 * to.
 *
 * `bigint` rather than `number`. Not because a realistic amount exceeds
 * `Number.MAX_SAFE_INTEGER` — it does not — but because `number` is a double,
 * and a double will silently accept `0.5` where an integer count of minor
 * units was meant. `bigint` makes that a `TypeError` at the boundary instead of
 * a rounding difference three layers down. There is no arithmetic in this
 * module that a floating-point value can enter.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/**
 * A money rule was broken.
 *
 * Distinct from a generic `Error` so a caller can tell "this input could never
 * be money" from "this operation failed", and so a test can assert the class
 * rather than matching on a message.
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertStorable(amountMinor: bigint): void {
  if (
    amountMinor < minimumStorableMinorUnits ||
    amountMinor > maximumStorableMinorUnits
  ) {
    throw new MoneyError(
      `Amount ${amountMinor.toString()} is outside the storable minor-unit range`,
    );
  }
}

/**
 * Builds a money value, or refuses.
 *
 * The only constructor. It refuses an unknown currency rather than defaulting
 * to two decimal places, because an amount in a currency the platform holds no
 * metadata for is not a small problem to paper over — it is an amount nobody
 * can render, compare, or settle correctly.
 */
export function money(amountMinor: bigint, currency: string): Money {
  if (typeof amountMinor !== 'bigint') {
    throw new MoneyError('An amount must be an integer count of minor units');
  }
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Unsupported currency ${currency}`);
  }
  assertStorable(amountMinor);
  return { amountMinor, currency };
}

export function zeroMoney(currency: string): Money {
  return money(0n, currency);
}

/** Parses the canonical wire spelling. Never accepts a JSON number. */
export function moneyFromMinorUnits(
  amountMinor: string,
  currency: string,
): Money {
  if (!/^(?:0|-?[1-9][0-9]{0,18})$/u.test(amountMinor)) {
    throw new MoneyError(`Malformed minor-unit amount ${amountMinor}`);
  }
  return money(BigInt(amountMinor), currency);
}

/** The canonical wire spelling. */
export function minorUnitsOf(value: Money): string {
  return value.amountMinor.toString();
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new MoneyError(
      `Cannot combine ${left.currency} with ${right.currency}`,
    );
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

/**
 * Sums amounts that are already known to share a currency.
 *
 * The currency is a required argument rather than being taken from the first
 * element, so an empty list still produces a typed zero and a list that
 * disagrees with its stated currency is a refusal rather than a silent
 * reinterpretation.
 */
export function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce<Money>(
    (total, value) => addMoney(total, value),
    zeroMoney(currency),
  );
}

export function compareMoney(left: Money, right: Money): number {
  assertSameCurrency(left, right);
  if (left.amountMinor === right.amountMinor) return 0;
  return left.amountMinor < right.amountMinor ? -1 : 1;
}

export function moneyEquals(left: Money, right: Money): boolean {
  return (
    left.currency === right.currency && left.amountMinor === right.amountMinor
  );
}

export function isPositiveMoney(value: Money): boolean {
  return value.amountMinor > 0n;
}

export function isNegativeMoney(value: Money): boolean {
  return value.amountMinor < 0n;
}

export function isZeroMoney(value: Money): boolean {
  return value.amountMinor === 0n;
}

/**
 * How many decimal places this currency divides into.
 *
 * Re-exported through the money module so a caller never has to reach past it
 * into the contract package for half of what an amount means.
 */
export function minorUnitExponentOf(value: Money): number {
  return currencyMinorUnitExponent(value.currency);
}

export type { CurrencyCode };
