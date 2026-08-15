import { describe, expect, it } from 'bun:test';
import {
  clubLifecycleValues,
  membershipSourceValues,
  membershipStateValues,
} from '@velora/validation';

import {
  LocalTestBillingEntitlement,
  UnavailableBillingEntitlement,
  type BillingEntitlementPort,
} from '../../src/clubs/billing.js';
import * as schemaPolicy from '../../src/clubs/policy.js';
import { testServerConfig } from '../support/harness.js';

/**
 * The commercial seam, and what it is allowed to do.
 *
 * The property that matters is not that a test adapter works. It is that no
 * deployed environment can reach one, and that the configured adapter refuses
 * rather than returning an unconfirmed pass — because an entitlement granted on
 * a provider that does not exist is somebody being told they bought something.
 */
describe('the billing entitlement seam', () => {
  it('refuses rather than granting anything, in every environment', async () => {
    // Held as the port rather than the class, because what production wires is
    // the port and that is what has to refuse.
    const port: BillingEntitlementPort = new UnavailableBillingEntitlement();
    expect(port.provider).toBe('unavailable');
    let refusal: unknown;
    try {
      await port.confirm({
        clubId: 'club',
        commercialReference: 'reference',
        memberId: 'member',
      });
    } catch (error) {
      refusal = error;
    }
    // It rejects rather than answering. An unconfirmed pass would be an
    // entitlement granted on a provider that does not exist.
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(
      'No approved billing provider is configured',
    );
  });

  it('is the configured adapter by default', () => {
    expect(testServerConfig().CLUBS_BILLING_ENTITLEMENT).toBe('unavailable');
  });

  it('cannot be replaced in staging or production, whatever is configured', () => {
    for (const environment of ['staging', 'production']) {
      let refused = false;
      try {
        testServerConfig({
          APP_ENV: environment,
          AUTH_ACCESS_TOKEN_SIGNING_KEY: undefined,
          CLUBS_BILLING_ENTITLEMENT: 'local-test',
        });
      } catch {
        refused = true;
      }
      // There is no environment string, header, or route that reaches the test
      // adapter in a deployed environment: configuration refuses to load at all.
      expect(refused, environment).toBe(true);
    }
  });

  it('names its source rather than claiming a payment happened', async () => {
    const local: BillingEntitlementPort = new LocalTestBillingEntitlement();
    const result = await local.confirm({
      clubId: 'club',
      commercialReference: 'reference',
      memberId: 'member',
    });
    // Even the test adapter records provenance rather than a `paid` boolean, so
    // a complimentary invitation and a commercial grant stay distinguishable.
    expect(result.source).toBe('billing');
    expect(membershipSourceValues).toContain(result.source);
  });
});

describe('club vocabulary is stated once', () => {
  it('keeps the schema values identical to the published contract', () => {
    expect([...schemaPolicy.clubLifecycles]).toEqual([...clubLifecycleValues]);
    expect([...schemaPolicy.membershipSources]).toEqual([
      ...membershipSourceValues,
    ]);
    expect([...schemaPolicy.membershipStates]).toEqual([
      ...membershipStateValues,
    ]);
  });

  it('bounds an invitation in time and gives it real entropy', () => {
    // A bearer credential that never expires is a permanent key left wherever
    // it was last pasted.
    expect(schemaPolicy.clubInviteLifetimeMilliseconds).toBeGreaterThan(0);
    expect(schemaPolicy.clubInviteSecretBytes * 8).toBeGreaterThanOrEqual(256);
  });
});
