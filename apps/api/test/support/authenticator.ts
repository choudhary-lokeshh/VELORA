import type {
  PrivilegedAuthenticatorAssertion,
  PrivilegedAuthenticatorRegistration,
  PrivilegedAuthenticatorRegistrationResult,
  PrivilegedAuthenticatorVerification,
  PrivilegedAuthenticatorVerifier,
} from '../../src/auth/identity-provider.js';

/**
 * Deterministic stand-in for a phishing-resistant authenticator verifier.
 *
 * It performs no cryptography and claims none. It exists so the privileged
 * access rules — enrolment, step-up, assurance freshness, exact-action binding,
 * dual control — can be exercised without building a real authenticator into
 * every test. It lives in the test tree so no composition root can select it;
 * the real ceremony is `WebAuthnAuthenticatorVerifier` and is proved on its
 * own.
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

  register(input: {
    readonly challenge: string;
    readonly registration: PrivilegedAuthenticatorRegistration;
  }): Promise<PrivilegedAuthenticatorRegistrationResult | undefined> {
    return Promise.resolve({
      credentialId: input.registration.credentialId,
      publicKey: input.registration.publicKey,
      signCount: readSignCount(input.registration.authenticatorData),
    });
  }

  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined> {
    this.attempts.push(input.assertion);
    if (!this.accept(input)) return Promise.resolve(undefined);
    return Promise.resolve({
      countersSupported: this.countersSupported,
      signCount: this.countersSupported
        ? readSignCount(input.assertion.authenticatorData)
        : 0,
    });
  }
}

/**
 * Authenticator data carrying one signature counter and nothing else that
 * matters: 32 bytes of relying-party hash, a flags byte with user presence and
 * user verification set, then the counter.
 */
export function scriptedAuthenticatorData(signCount: number): string {
  const bytes = Buffer.alloc(37);
  bytes[32] = 0x05;
  bytes.writeUInt32BE(signCount, 33);
  return bytes.toString('base64url');
}

/** A complete scripted assertion at a given counter. */
export function scriptedAssertion(input: {
  readonly credentialId: string;
  readonly signCount: number;
}): PrivilegedAuthenticatorAssertion {
  return {
    authenticatorData: scriptedAuthenticatorData(input.signCount),
    clientDataJSON: Buffer.from(
      JSON.stringify({
        challenge: 'scripted',
        origin: 'https://admin.velora.test',
        type: 'webauthn.get',
      }),
      'utf8',
    ).toString('base64url'),
    credentialId: input.credentialId,
    signature: 'c2NyaXB0ZWQ',
  };
}

function readSignCount(authenticatorData: string): number {
  const bytes = Buffer.from(authenticatorData, 'base64url');
  return bytes.length < 37 ? 0 : bytes.readUInt32BE(33);
}
