import type { MembershipSource } from './policy.js';

/**
 * The seam a future payment system will grant access through.
 *
 * `docs/flows/creator-entitlement.md` puts the commercial fact in BILLING and
 * the access fact here, and requires the second to be projected from the first
 * rather than inferred. This port is that projection point: when a provider
 * exists, a confirmed commercial operation arrives here with its own reference
 * and becomes a membership whose source records where it came from. Creator
 * content authorization does not change when that happens, which is the whole
 * point of having the seam now.
 *
 * Nothing implements it. `docs/product/01-product-phases.md` puts creator
 * subscriptions and PPV in a later phase and no payment provider is approved,
 * so the configured implementation refuses in every environment. A test
 * implementation exists for local and test only, and configuration is what
 * decides which one is built — there is no route, header, or environment string
 * a caller can use to reach the test one in a deployed environment.
 */
export interface BillingEntitlementRequest {
  readonly clubId: string;
  /** The commercial operation this access is claimed to follow from. */
  readonly commercialReference: string;
  readonly memberId: string;
}

export interface BillingEntitlementResult {
  readonly confirmed: boolean;
  readonly source: MembershipSource;
}

export interface BillingEntitlementPort {
  /** Adapter name recorded for audit and routing. */
  readonly provider: string;
  confirm(
    request: BillingEntitlementRequest,
  ): Promise<BillingEntitlementResult>;
}

/**
 * The configured port everywhere, because no provider is approved.
 *
 * It refuses rather than returning an unconfirmed pass, so a billing-backed
 * entitlement is unreachable in every environment until a real adapter is
 * chosen and reviewed. That is the fail-closed behaviour the security baseline
 * requires of a commercial gate, and it is why `billing` can appear in the
 * membership vocabulary without any row ever carrying it.
 */
export class UnavailableBillingEntitlement implements BillingEntitlementPort {
  readonly provider = 'unavailable';

  confirm(): Promise<BillingEntitlementResult> {
    return Promise.reject(
      new Error('No approved billing provider is configured'),
    );
  }
}

/**
 * Development and test adapter.
 *
 * It exists so the projection path is exercisable before a provider is chosen,
 * and it is named so no test using it can be read as evidence about a real
 * one. Configuration refuses it outside the local and test application
 * environments, so it can never grant access in a deployed one.
 */
export class LocalTestBillingEntitlement implements BillingEntitlementPort {
  readonly provider = 'local-test';

  confirm(): Promise<BillingEntitlementResult> {
    return Promise.resolve({ confirmed: true, source: 'billing' });
  }
}
