/**
 * Identity provider boundary. ADR-0009 keeps credential, social, OTP, passkey,
 * and identity-provider integrations behind AUTH adapters and treats provider
 * subject identifiers as external references, never authorization truth.
 *
 * Two adapters exist. The development/test one below performs no credential
 * check and claims none: it maps a caller-supplied subject to a stable provider
 * reference so the rest of AUTH is buildable and testable, and configuration
 * refuses it in staging and production. The OpenID Connect adapter in
 * `oidc.ts` is the deployable one: it verifies an assertion a provider signed
 * before any subject is believed.
 */

export interface IdentityAssertion {
  readonly provider: string;
  readonly providerSubject: string;
}

export interface IdentityProvider {
  readonly name: string;
  /**
   * Normalises a subject this platform already holds into the reference form
   * the provider uses. It is not authentication and never was: recovery calls
   * it to reach the same stable reference a completed sign-in produced.
   */
  assert(subject: string): IdentityAssertion;
}

/**
 * The additional capability a provider needs to actually authenticate somebody
 * through a browser: send them somewhere, and believe what comes back.
 *
 * Separate from {@link IdentityProvider} rather than folded into it, because
 * the development adapter genuinely has no ceremony — it maps a string — and an
 * interface that pretended otherwise would put two unimplementable methods on
 * it and lose the compiler's help in telling the two apart.
 */
export interface FederatedIdentityProvider extends IdentityProvider {
  /**
   * The address to send a browser to, carrying the single-use state, nonce, and
   * PKCE challenge this platform minted for exactly this attempt.
   */
  authorizationUrl(input: {
    readonly codeChallenge: string;
    readonly nonce: string;
    readonly state: string;
  }): Promise<string>;
  /**
   * Exchanges an authorization code over the back channel and verifies the
   * assertion that comes back. Returns undefined for every rejection: a caller
   * learns that sign-in did not complete and nothing about why, because the
   * difference between a forged code and an expired one is information about
   * this platform's trust decisions.
   */
  completeAuthorization(input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  }): Promise<IdentityAssertion | undefined>;
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
 * passkey MFA before privileged production access.
 *
 * Three implementations sit behind this port. `unavailable` refuses every
 * assertion and is the fail-closed default. The `local-test-privileged`
 * adapter accepts every assertion and exists so the Platform Admin flow is
 * walkable in local development (ADR-0034); configuration refuses it in staging
 * and production. `WebAuthnAuthenticatorVerifier` in `webauthn.ts` performs the
 * real ceremony and is the one a deployed environment must select.
 */
export interface PrivilegedAuthenticatorAssertion {
  /**
   * Raw authenticator data, base64url. It carries the relying-party hash, the
   * user-presence and user-verification flags, and the signature counter, and
   * it is half of what the authenticator signed — so the counter is read from
   * here rather than taken from a field a client could set.
   */
  readonly authenticatorData: string;
  /**
   * The exact client data the browser produced, base64url. Its SHA-256 is the
   * other half of the signed message, and its contents name the ceremony, the
   * challenge, and the origin the assertion was collected at.
   */
  readonly clientDataJSON: string;
  readonly credentialId: string;
  readonly signature: string;
}

/** What a browser produces when an operator enrols an authenticator. */
export interface PrivilegedAuthenticatorRegistration {
  /** The COSE algorithm identifier the authenticator chose. */
  readonly algorithm: number;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly credentialId: string;
  /** The credential public key as SPKI, base64url. */
  readonly publicKey: string;
}

/** What the platform stores once a registration has been verified. */
export interface PrivilegedAuthenticatorRegistrationResult {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
}

export interface PrivilegedAuthenticatorVerifier {
  readonly kind: string;
  /**
   * Verifies an enrolment against a challenge AUTH issued exactly once, and
   * returns the credential to store. Returns undefined for every rejection.
   */
  register(input: {
    readonly challenge: string;
    readonly registration: PrivilegedAuthenticatorRegistration;
  }): Promise<PrivilegedAuthenticatorRegistrationResult | undefined>;
  /**
   * Verifies an assertion against an enrolled credential and a challenge AUTH
   * issued exactly once. It returns the counter the authenticator reported and
   * whether that authenticator maintains one at all, because "counter did not
   * advance" only means cloning for authenticators that keep counters.
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

  register(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

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

  register(input: {
    readonly challenge: string;
    readonly registration: PrivilegedAuthenticatorRegistration;
  }): Promise<PrivilegedAuthenticatorRegistrationResult | undefined> {
    return Promise.resolve({
      credentialId: input.registration.credentialId,
      publicKey: input.registration.publicKey,
      signCount: readSignCount(input.registration.authenticatorData) ?? 0,
    });
  }

  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined> {
    // The counter is read out of the authenticator data rather than taken from
    // a separate field, exactly as the real verifier does. Nothing else about
    // the assertion is checked, which is the whole point of this adapter and
    // the reason configuration refuses it outside local and test.
    const signCount = readSignCount(input.assertion.authenticatorData) ?? 0;
    return Promise.resolve({
      countersSupported: signCount !== 0,
      signCount,
    });
  }
}

/**
 * The signature counter's fixed position in authenticator data: 32 bytes of
 * relying-party hash, one flag byte, then a four-byte big-endian counter.
 * Shared with the real verifier's reading of the same field so the local
 * adapter cannot drift into a different idea of what a counter is.
 */
function readSignCount(authenticatorData: string): number | undefined {
  const bytes = Buffer.from(authenticatorData, 'base64url');
  if (bytes.length < 37) return undefined;
  return bytes.readUInt32BE(33);
}
