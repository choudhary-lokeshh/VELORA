/**
 * Identity provider boundary. ADR-0009 keeps credential, social, OTP, passkey,
 * and identity-provider integrations behind AUTH adapters and treats provider
 * subject identifiers as external references, never authorization truth.
 *
 * The only adapter that exists is the development/test one below. It performs
 * no credential check and claims none: it maps a caller-supplied subject to a
 * stable provider reference so the rest of AUTH can be built and tested before
 * a provider is chosen. Configuration refuses it in staging and production.
 */

export interface IdentityAssertion {
  readonly provider: string;
  readonly providerSubject: string;
}

export interface IdentityProvider {
  readonly name: string;
  assert(subject: string): IdentityAssertion;
}

const subjectPattern = /^[a-z0-9._@+-]{1,200}$/u;

export class LocalIdentityProvider implements IdentityProvider {
  readonly name = 'local';

  assert(subject: string): IdentityAssertion {
    const normalized = subject.trim().toLowerCase();
    if (!subjectPattern.test(normalized)) {
      throw new Error('Local identity subject is not acceptable');
    }
    return { provider: this.name, providerSubject: normalized };
  }
}

/**
 * Verifier for phishing-resistant authenticators. ADR-0017 mandates WebAuthn or
 * passkey MFA before privileged production access. No implementation is
 * approved, and hand-rolling WebAuthn verification would be a fabricated
 * control, so the production-selectable implementation refuses every assertion.
 */
export interface PrivilegedAuthenticatorAssertion {
  readonly clientDataDigest: string;
  readonly credentialId: string;
  /**
   * The authenticator's signature counter. Many modern passkeys and
   * multi-device credentials do not implement one and always report zero; the
   * verifier reports what the authenticator said, and AUTH interprets it.
   */
  readonly signCount: number;
  readonly signature: string;
}

export interface PrivilegedAuthenticatorVerifier {
  readonly kind: string;
  /**
   * Verifies an assertion against an enrolled credential and a challenge the
   * verifier is responsible for having issued exactly once. It returns the
   * counter the authenticator reported and whether that authenticator maintains
   * one at all, because "counter did not advance" only means cloning for
   * authenticators that keep counters.
   */
  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined>;
}

export interface PrivilegedAuthenticatorVerification {
  /** False for authenticators that report no usable counter, such as most passkeys. */
  readonly countersSupported: boolean;
  readonly signCount: number;
}

export class UnavailablePrivilegedAuthenticatorVerifier implements PrivilegedAuthenticatorVerifier {
  readonly kind = 'unavailable';

  verify(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

/**
 * Deterministic local-test privileged authenticator verifier.
 *
 * Performs no cryptography, reaches no network, and accepts every assertion.
 * It exists solely for local development and integration testing of the
 * Platform Admin privileged access flow (ADR-0034).
 * Staging and production configuration hard-rejects this adapter at startup.
 */
export class LocalTestPrivilegedAuthenticatorVerifier implements PrivilegedAuthenticatorVerifier {
  readonly kind = 'local-test-privileged';

  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined> {
    return Promise.resolve({
      countersSupported: false,
      signCount: input.assertion.signCount,
    });
  }
}
