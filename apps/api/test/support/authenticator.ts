import type {
  PrivilegedAuthenticatorAssertion,
  PrivilegedAuthenticatorVerification,
  PrivilegedAuthenticatorVerifier,
} from '../../src/auth/identity-provider.js';

/**
 * Deterministic stand-in for a phishing-resistant authenticator verifier.
 *
 * It performs no cryptography and claims none. It exists only so the privileged
 * access rules — enrolment, step-up, assurance freshness, exact-action binding,
 * dual control — can be exercised before a real WebAuthn implementation is
 * approved. It lives in the test tree so no composition root can select it, and
 * the implementation the application does select refuses every assertion.
 */
export class ScriptedAuthenticatorVerifier implements PrivilegedAuthenticatorVerifier {
  readonly kind = 'scripted-test-double';
  readonly attempts: PrivilegedAuthenticatorAssertion[] = [];

  constructor(
    private readonly accept: (input: {
      readonly assertion: PrivilegedAuthenticatorAssertion;
      readonly challenge: string;
      readonly publicKey: string;
    }) => boolean = () => true,
    /** Mirrors an authenticator that keeps no counter, such as most passkeys. */
    private readonly countersSupported = true,
  ) {}

  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined> {
    this.attempts.push(input.assertion);
    if (!this.accept(input)) return Promise.resolve(undefined);
    return Promise.resolve({
      countersSupported: this.countersSupported,
      signCount: this.countersSupported ? input.assertion.signCount : 0,
    });
  }
}
