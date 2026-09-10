import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';

import type {
  PrivilegedAuthenticatorAssertion,
  PrivilegedAuthenticatorRegistration,
  PrivilegedAuthenticatorRegistrationResult,
  PrivilegedAuthenticatorVerification,
  PrivilegedAuthenticatorVerifier,
} from './identity-provider.js';

/**
 * WebAuthn verification for privileged access.
 *
 * The property this buys is phishing resistance, and it comes from two facts
 * the authenticator signs over rather than from anything the client asserts.
 * The first is the challenge, which this server minted and stores exactly once,
 * so a captured assertion is worth nothing a second time. The second is the
 * origin, which the browser writes into the client data itself and which no
 * page can forge — an operator phished onto `velora-admin.example` produces an
 * assertion naming that origin, and it verifies nowhere.
 *
 * There is no CBOR here, and that is deliberate rather than a shortcut. The
 * browser exposes the credential public key as SPKI and the authenticator data
 * as raw bytes through `getPublicKey()` and `getAuthenticatorData()`, so the
 * server receives exactly the two structures it has to check and parses neither
 * an attestation object nor a COSE key. Every byte this module reads is either
 * a fixed-offset field of authenticator data or plain JSON, which is the
 * smallest parser this ceremony can be built on.
 *
 * Attestation is not requested and not verified. That is the recommended
 * posture for a relying party that is not enforcing an enterprise authenticator
 * allowlist: the trust in an enrolled credential comes from the enrolment being
 * performed by an already-authenticated operator against a challenge this
 * server issued, not from a certificate chain nobody has decided how to pin.
 */

/** Client data and authenticator data are exchanged as base64url. */
const base64UrlPattern = /^[A-Za-z0-9_-]*$/u;

/**
 * Authenticator data is 37 bytes before any attested credential data: a
 * 32-byte relying-party identifier hash, one flag byte, and a four-byte
 * big-endian signature counter.
 */
const relyingPartyHashBytes = 32;
const flagsOffset = 32;
const signCountOffset = 33;
const minimumAuthenticatorDataBytes = 37;

const userPresentFlag = 0x01;
const userVerifiedFlag = 0x04;

/**
 * The COSE algorithm identifiers this platform accepts, and the only three
 * worth accepting: Ed25519, ECDSA over P-256, and RSASSA-PKCS1-v1_5 with
 * SHA-256. Every current platform and roaming authenticator produces one of
 * them, and the list is closed so a credential arrives on an algorithm this
 * server has decided to verify rather than on one a client named.
 */
export const supportedCoseAlgorithms = [-8, -7, -257] as const;

export interface WebAuthnVerifierOptions {
  /** The registrable domain every credential is scoped to. */
  readonly relyingPartyId: string;
  /** The exact origins an assertion or a registration may be collected at. */
  readonly origins: readonly string[];
}

interface ClientData {
  readonly challenge: string;
  readonly origin: string;
  readonly type: string;
}

interface AuthenticatorData {
  readonly relyingPartyIdHash: Buffer;
  readonly signCount: number;
  readonly userPresent: boolean;
  readonly userVerified: boolean;
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!base64UrlPattern.test(value) || value.length === 0) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  // `Buffer.from` never fails, so a value that decoded to nothing is the only
  // signal that the input was not what it claimed to be.
  return decoded.length === 0 ? undefined : decoded;
}

function readClientData(encoded: string): ClientData | undefined {
  const bytes = decodeBase64Url(encoded);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { challenge, origin, type } = parsed as Record<string, unknown>;
  if (
    typeof challenge !== 'string' ||
    typeof origin !== 'string' ||
    typeof type !== 'string'
  ) {
    return undefined;
  }
  return { challenge, origin, type };
}

function readAuthenticatorData(encoded: string): AuthenticatorData | undefined {
  const bytes = decodeBase64Url(encoded);
  if (bytes === undefined || bytes.length < minimumAuthenticatorDataBytes) {
    return undefined;
  }
  const flags = bytes[flagsOffset];
  if (flags === undefined) return undefined;
  return {
    relyingPartyIdHash: bytes.subarray(0, relyingPartyHashBytes),
    signCount: bytes.readUInt32BE(signCountOffset),
    userPresent: (flags & userPresentFlag) !== 0,
    userVerified: (flags & userVerifiedFlag) !== 0,
  };
}

/**
 * Compares two values of equal, public length without leaking where they first
 * differ. The challenge is the value worth protecting here: it is a secret this
 * server issued, and an early-exit comparison against a caller-supplied string
 * is the classic way to let one be guessed a character at a time.
 */
function equalsConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The public key of an enrolled credential, and the algorithm to verify it
 * with, both derived from the stored SPKI.
 *
 * Storing the algorithm separately would be storing the same fact twice, and
 * the copy would be the one a caller could influence at enrolment. The key
 * itself already says what it is.
 */
function readPublicKey(
  encoded: string,
): { readonly algorithm: string | null; readonly key: KeyObject } | undefined {
  const bytes = decodeBase64Url(encoded);
  if (bytes === undefined) return undefined;
  let key: KeyObject;
  try {
    key = createPublicKey({ format: 'der', key: bytes, type: 'spki' });
  } catch {
    return undefined;
  }
  switch (key.asymmetricKeyType) {
    case 'ed25519': {
      // Ed25519 hashes internally; Node requires a null algorithm for it.
      return { algorithm: null, key };
    }
    case 'ec': {
      const curve = key.asymmetricKeyDetails?.namedCurve;
      if (curve !== 'prime256v1') return undefined;
      return { algorithm: 'sha256', key };
    }
    case 'rsa': {
      return { algorithm: 'sha256', key };
    }
    default: {
      return undefined;
    }
  }
}

export class WebAuthnAuthenticatorVerifier implements PrivilegedAuthenticatorVerifier {
  readonly kind = 'webauthn';
  private readonly origins: ReadonlySet<string>;
  private readonly relyingPartyIdHash: Buffer;

  constructor(private readonly options: WebAuthnVerifierOptions) {
    this.origins = new Set(options.origins);
    this.relyingPartyIdHash = createHash('sha256')
      .update(options.relyingPartyId, 'utf8')
      .digest();
  }

  /**
   * Everything both ceremonies check, in one place: the client data names the
   * expected ceremony, carries the challenge this server issued, and was
   * collected at an origin this deployment allows; and the authenticator data
   * is scoped to this relying party, saw the person, and verified them.
   *
   * User verification is required rather than preferred. This is the gate in
   * front of every privileged action, so an authenticator that reports a touch
   * and no verification has not established what ADR-0017 asks for.
   */
  private checkCeremony(input: {
    readonly authenticatorData: string;
    readonly challenge: string;
    readonly clientDataJSON: string;
    readonly type: 'webauthn.create' | 'webauthn.get';
  }): AuthenticatorData | undefined {
    const clientData = readClientData(input.clientDataJSON);
    if (clientData === undefined) return undefined;
    if (clientData.type !== input.type) return undefined;
    if (!equalsConstantTime(clientData.challenge, input.challenge)) {
      return undefined;
    }
    if (!this.origins.has(clientData.origin)) return undefined;

    const authenticatorData = readAuthenticatorData(input.authenticatorData);
    if (authenticatorData === undefined) return undefined;
    if (!authenticatorData.relyingPartyIdHash.equals(this.relyingPartyIdHash)) {
      return undefined;
    }
    if (!authenticatorData.userPresent || !authenticatorData.userVerified) {
      return undefined;
    }
    return authenticatorData;
  }

  register(input: {
    readonly challenge: string;
    readonly registration: PrivilegedAuthenticatorRegistration;
  }): Promise<PrivilegedAuthenticatorRegistrationResult | undefined> {
    const { registration } = input;
    if (
      !supportedCoseAlgorithms.includes(
        registration.algorithm as (typeof supportedCoseAlgorithms)[number],
      )
    ) {
      return Promise.resolve(undefined);
    }
    const authenticatorData = this.checkCeremony({
      authenticatorData: registration.authenticatorData,
      challenge: input.challenge,
      clientDataJSON: registration.clientDataJSON,
      type: 'webauthn.create',
    });
    if (authenticatorData === undefined) return Promise.resolve(undefined);

    // The key has to be one this server can actually verify with later. A
    // credential accepted here and unverifiable at every future step-up would
    // be an operator locked out by their own enrolment.
    const publicKey = readPublicKey(registration.publicKey);
    if (publicKey === undefined) return Promise.resolve(undefined);
    if (decodeBase64Url(registration.credentialId) === undefined) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      credentialId: registration.credentialId,
      publicKey: registration.publicKey,
      signCount: authenticatorData.signCount,
    });
  }

  verify(input: {
    readonly assertion: PrivilegedAuthenticatorAssertion;
    readonly challenge: string;
    readonly publicKey: string;
  }): Promise<PrivilegedAuthenticatorVerification | undefined> {
    const authenticatorData = this.checkCeremony({
      authenticatorData: input.assertion.authenticatorData,
      challenge: input.challenge,
      clientDataJSON: input.assertion.clientDataJSON,
      type: 'webauthn.get',
    });
    if (authenticatorData === undefined) return Promise.resolve(undefined);

    const stored = readPublicKey(input.publicKey);
    const signature = decodeBase64Url(input.assertion.signature);
    const rawAuthenticatorData = decodeBase64Url(
      input.assertion.authenticatorData,
    );
    const rawClientData = decodeBase64Url(input.assertion.clientDataJSON);
    if (
      stored === undefined ||
      signature === undefined ||
      rawAuthenticatorData === undefined ||
      rawClientData === undefined
    ) {
      return Promise.resolve(undefined);
    }

    // The signed message is the authenticator data followed by the SHA-256 of
    // the client data, exactly as the specification defines it. Nothing else is
    // signed, so nothing else may be trusted.
    const signedMessage = Buffer.concat([
      rawAuthenticatorData,
      createHash('sha256').update(rawClientData).digest(),
    ]);

    let signed = false;
    try {
      signed = verifyBytes(
        stored.algorithm,
        signedMessage,
        stored.key,
        signature,
      );
    } catch {
      return Promise.resolve(undefined);
    }
    if (!signed) return Promise.resolve(undefined);

    return Promise.resolve({
      // A counter this authenticator does not keep reports zero forever, and
      // most passkeys do exactly that. Reporting that fact rather than a
      // number lets AUTH tell "did not advance" apart from "has no counter".
      countersSupported: authenticatorData.signCount !== 0,
      signCount: authenticatorData.signCount,
    });
  }
}
