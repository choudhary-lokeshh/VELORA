import { describe, expect, it } from 'bun:test';

import {
  LocalTestCommerceEligibility,
  UnavailableCommerceEligibility,
  commerceEligibilityGates,
  type CommerceEligibility,
} from '../../src/billing/commerce-eligibility.js';
import {
  LocalTestTaxAuthority,
  UnavailableTaxAuthority,
  storedAssessment,
  type TaxAuthorityPort,
} from '../../src/billing/tax.js';
import { money } from '../../src/money/money.js';

/**
 * The two authorities that decide whether Velora may transact at all.
 *
 * They exist because "global" is the default nobody decides and everybody
 * assumes, and because a tax component nobody assessed is an unremitted
 * liability nobody chose to accrue. What these tests pin is that neither has a
 * permissive fallback: an unknown country refuses, an absent authority refuses,
 * and the deployable implementations refuse everything.
 */
describe('the commerce eligibility authority', () => {
  it('refuses every pairing and reports every gate in a deployed environment', () => {
    const authority: CommerceEligibility = new UnavailableCommerceEligibility();
    expect(authority.consumerCountries()).toEqual([]);
    expect(authority.creatorCountries()).toEqual([]);
    const verdict = authority.evaluate({
      consumerCountry: 'ES',
      sellerCountry: 'ES',
      currency: 'EUR',
    });
    // Every gate, not the first one found: an operator needs to know that all
    // of them are shut rather than being sent to open one.
    expect(verdict).toEqual({
      gates: [...commerceEligibilityGates],
      kind: 'refused',
    });
  });

  it('treats an absent country as a refusal rather than a wildcard', () => {
    const authority = new LocalTestCommerceEligibility();
    // The failure this seam exists to prevent: an unknown value reading as
    // permission the first time somebody with an unexpected address arrives.
    expect(
      authority.evaluate({
        consumerCountry: undefined,
        sellerCountry: 'ES',
        currency: 'EUR',
      }),
    ).toEqual({ gates: ['consumer_country'], kind: 'refused' });
    expect(
      authority.evaluate({
        consumerCountry: 'ES',
        sellerCountry: undefined,
        currency: 'EUR',
      }),
    ).toEqual({ gates: ['creator_country'], kind: 'refused' });
  });

  it('keeps selling-into and selling-from as separate lists', () => {
    const authority = new LocalTestCommerceEligibility();
    // Japan is somewhere the test policy will sell into and not somewhere it
    // will sell from. One list would have collapsed two questions that answer
    // to different law.
    expect(authority.consumerCountries()).toContain('JP');
    expect(authority.creatorCountries()).not.toContain('JP');
    expect(
      authority.evaluate({
        consumerCountry: 'JP',
        sellerCountry: 'JP',
        currency: 'JPY',
      }),
    ).toEqual({ gates: ['creator_country'], kind: 'refused' });
  });

  it('reports every shut gate at once rather than the first', () => {
    const authority = new LocalTestCommerceEligibility();
    expect(
      authority.evaluate({
        consumerCountry: 'BR',
        sellerCountry: 'BR',
        currency: 'BRL',
      }),
    ).toEqual({
      gates: ['consumer_country', 'creator_country', 'currency'],
      kind: 'refused',
    });
  });

  it('permits only a pairing every gate accepts', () => {
    expect(
      new LocalTestCommerceEligibility().evaluate({
        consumerCountry: 'ES',
        sellerCountry: 'ES',
        currency: 'EUR',
      }),
    ).toEqual({ kind: 'permitted' });
  });
});

describe('the tax authority', () => {
  it('assesses nothing in a deployed environment', async () => {
    // Not zero: nothing. A platform with no tax engine cannot charge somebody a
    // price whose tax component it assumed was nil.
    const authority: TaxAuthorityPort = new UnavailableTaxAuthority();
    expect(
      await authority.assess({
        consumerCountry: 'ES',
        sellerCountry: 'ES',
        gross: money(1500n, 'EUR'),
      }),
    ).toBeUndefined();
  });

  it('distinguishes an authoritative zero from no authority', async () => {
    const assessment = await new LocalTestTaxAuthority().assess({
      consumerCountry: 'ES',
      sellerCountry: 'ES',
      gross: money(1500n, 'EUR'),
    });
    // A zero that names who said it. The difference between this and
    // `undefined` is the whole point: one is an answer and the other is silence.
    expect(assessment).toEqual({
      amount: money(0n, 'EUR'),
      authority: 'local-test',
    });
  });

  it('reads a snapshot back only when both halves are present', () => {
    expect(
      storedAssessment({ currency: 'EUR', taxAuthority: null, taxMinor: 0n }),
    ).toBeUndefined();
    expect(
      storedAssessment({
        currency: 'EUR',
        taxAuthority: 'local-test',
        taxMinor: null,
      }),
    ).toBeUndefined();
    expect(
      storedAssessment({
        currency: 'EUR',
        taxAuthority: 'local-test',
        taxMinor: 0n,
      }),
    ).toEqual({ amount: money(0n, 'EUR'), authority: 'local-test' });
  });
});
