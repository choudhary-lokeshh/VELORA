import type { AdultAssuranceClass, AdultAssuranceOutcome } from './schema.js';

/**
 * Provider-neutral adult-assurance seam.
 *
 * `docs/architecture/06-provider-adapters.md` requires vendor behavior to stay
 * behind a port, and `docs/compliance/02-adult-age-verification.md` requires the
 * owning domain — not the provider — to decide product access from a normalized
 * outcome. This port carries exactly that normalized outcome and nothing a
 * vendor SDK would otherwise leak into USERS.
 *
 * Self-declaration does not pass through here. It is not a verification: no
 * external party is consulted, so routing it through a verifier port would
 * misrepresent what happened.
 */

export interface AdultAssuranceRequest {
  readonly correlationId: string;
  /** Region the person declared, because adult age is country-dependent. */
  readonly region: string;
  readonly userId: string;
}

export interface AdultAssuranceResult {
  readonly assuranceClass: AdultAssuranceClass;
  /** Opaque provider-side reference. Never document, image, or birth data. */
  readonly evidenceReference?: string | undefined;
  readonly expiresAt?: Date | undefined;
  readonly outcome: AdultAssuranceOutcome;
}

export interface AdultAssuranceVerifier {
  /** Adapter name recorded on the assurance row for audit and recheck routing. */
  readonly method: string;
  verify(request: AdultAssuranceRequest): Promise<AdultAssuranceResult>;
}

/**
 * The configured verifier everywhere, because no provider is approved.
 *
 * It refuses rather than returning a weak pass, so a capability that requires
 * verified adult assurance is unreachable in every environment until a real
 * adapter is chosen. That is the fail-closed behavior the security baseline
 * requires of a compliance gate.
 */
export class UnavailableAdultAssuranceVerifier implements AdultAssuranceVerifier {
  readonly method = 'unavailable';

  verify(): Promise<AdultAssuranceResult> {
    return Promise.reject(
      new Error('No approved adult assurance provider is configured'),
    );
  }
}

/**
 * Development and test adapter.
 *
 * It exists so the verified-assurance path is genuinely exercisable, and it is
 * named so no test using it can be read as evidence about a real provider.
 * Configuration refuses it outside the local and test application environments,
 * so it can never grant verified adult status in a deployed one.
 */
export class LocalTestAdultAssuranceVerifier implements AdultAssuranceVerifier {
  readonly method = 'local-test';

  constructor(
    private readonly outcome: AdultAssuranceOutcome = 'passed',
    private readonly validity?: {
      readonly milliseconds: number;
      /** Shares the caller's clock, so a recorded expiry is never before its decision. */
      readonly now: () => Date;
    },
  ) {}

  verify(request: AdultAssuranceRequest): Promise<AdultAssuranceResult> {
    return Promise.resolve({
      assuranceClass: 'verified_adult',
      // An opaque digest of the request, standing in for a provider-side
      // reference. No document, image, or birth date exists to store.
      evidenceReference: Bun.SHA256.hash(
        `${request.userId}:${request.region}`,
        'hex',
      ),
      ...(this.validity === undefined
        ? {}
        : {
            expiresAt: new Date(
              this.validity.now().getTime() + this.validity.milliseconds,
            ),
          }),
      outcome: this.outcome,
    });
  }
}
