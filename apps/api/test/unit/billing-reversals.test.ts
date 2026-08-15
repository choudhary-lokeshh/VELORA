import { describe, expect, it } from 'bun:test';
import {
  disputeReasonCodeValues,
  disputeStateValues,
  issueRefundRequestSchema,
  refundFailureReasonValues,
  refundReasonCodeValues,
  refundStateValues,
} from '@velora/validation';

import {
  providerDisputeReasons,
  providerDisputeStatuses,
} from '../../src/billing/provider.js';
import {
  disputeReasonCodes,
  disputeStates,
  openDisputeStates,
  outstandingRefundStates,
  refundFailureReasons,
  refundReasonCodes,
  refundStates,
  resolvedDisputeStates,
  terminalRefundStates,
} from '../../src/billing/reversal-policy.js';

/**
 * The reversal vocabularies, pinned.
 *
 * `drizzle-kit` cannot import the ESM-only contract package while generating
 * migrations, so every value a CHECK constraint needs is restated under
 * `src/billing/`. That duplication is only safe while the two agree: if they
 * ever drift, the database would enforce something other than what the contract
 * promises, and it would do so silently. This file makes that a failing build.
 *
 * The provider port is pinned to the same sets for a different reason. An
 * adapter maps a vendor's vocabulary onto Velora's, and a value the port could
 * emit that no column accepts would be a runtime failure discovered by a real
 * dispute rather than by a test.
 */
describe('reversal vocabularies agree across the schema, the contract, and the port', () => {
  it('states one refund lifecycle', () => {
    expect([...refundStates]).toEqual([...refundStateValues]);
    expect([...refundFailureReasons]).toEqual([...refundFailureReasonValues]);
    expect([...refundReasonCodes]).toEqual([...refundReasonCodeValues]);
  });

  it('states one dispute lifecycle, and the port speaks it', () => {
    expect([...disputeStates]).toEqual([...disputeStateValues]);
    expect([...disputeReasonCodes]).toEqual([...disputeReasonCodeValues]);
    expect([...providerDisputeStatuses]).toEqual([...disputeStates]);
    expect([...providerDisputeReasons]).toEqual([...disputeReasonCodes]);
  });

  /**
   * The over-refund bound is the sum of every reversal that has not been
   * refused. A state that was outstanding *and* terminal-but-not-failed would
   * either release money that was returned or reserve money that was not, and
   * both are how a capture ends up over-refunded without any single write being
   * wrong.
   */
  it('reserves against every reversal except a refusal', () => {
    expect([...outstandingRefundStates].toSorted()).toEqual(
      [...refundStates].filter((state) => state !== 'failed').toSorted(),
    );
    expect(
      [...terminalRefundStates].every((state) => state !== 'requested'),
    ).toBe(true);
    // A terminal state that is still outstanding is correct — a succeeded
    // reversal has spent its share of the capture permanently — but a terminal
    // state that is neither outstanding nor `failed` would be money nobody
    // accounts for.
    for (const state of terminalRefundStates) {
      expect(
        state === 'failed' || outstandingRefundStates.includes(state),
      ).toBe(true);
    }
  });

  it('splits dispute states into live and settled with nothing left over', () => {
    expect([...openDisputeStates, ...resolvedDisputeStates].toSorted()).toEqual(
      [...disputeStates].toSorted(),
    );
    for (const state of openDisputeStates) {
      expect(resolvedDisputeStates.includes(state)).toBe(false);
    }
  });
});

/**
 * What a reversal request may say.
 *
 * The contract is the first place a malformed amount is stopped, and it is
 * deliberately stricter than the storage: minor units arrive as a canonical
 * decimal string so no double ever touches a refund amount, and the currency is
 * required so a partial reversal of a JPY charge cannot be read as minor units
 * of something else.
 */
describe('the refund request contract', () => {
  const valid = {
    amountMinor: '1500',
    currency: 'USD',
    paymentId: '00000000-0000-4000-8000-000000000000',
    reasonCode: 'duplicate_charge',
  };

  it('accepts a well-formed reversal', () => {
    expect(issueRefundRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a fractional, negative, zero, or numeric amount', () => {
    for (const amountMinor of ['15.00', '-1500', '0', '01500', '+1500']) {
      expect(
        issueRefundRequestSchema.safeParse({ ...valid, amountMinor }).success,
      ).toBe(false);
    }
    // A JSON number is a double, and a double is exactly what the minor-unit
    // representation exists to keep out of a money field.
    expect(
      issueRefundRequestSchema.safeParse({ ...valid, amountMinor: 1500 })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown currency and a missing one', () => {
    expect(
      issueRefundRequestSchema.safeParse({ ...valid, currency: 'XXX' }).success,
    ).toBe(false);
    const withoutCurrency = {
      amountMinor: valid.amountMinor,
      paymentId: valid.paymentId,
      reasonCode: valid.reasonCode,
    };
    expect(issueRefundRequestSchema.safeParse(withoutCurrency).success).toBe(
      false,
    );
  });

  it('refuses a reason nobody published and any field nobody declared', () => {
    expect(
      issueRefundRequestSchema.safeParse({ ...valid, reasonCode: 'because' })
        .success,
    ).toBe(false);
    // Strict, so a caller cannot smuggle an instruction the server would ignore
    // but a reader of the request would believe.
    expect(
      issueRefundRequestSchema.safeParse({ ...valid, approvedBy: 'me' })
        .success,
    ).toBe(false);
  });
});
