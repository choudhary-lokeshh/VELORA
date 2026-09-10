/**
 * The browser half of the two privileged ceremonies.
 *
 * Everything security-relevant happens on the server: it issues the challenge,
 * consumes it exactly once, and verifies the assertion against the origin the
 * browser wrote into the client data. This module's whole job is to ask the
 * platform authenticator the right question and hand back exactly the four
 * structures the server needs, encoded the way the contract expects.
 *
 * It deliberately reads the credential public key through `getPublicKey()` and
 * the authenticator data through `getAuthenticatorData()` rather than parsing
 * an attestation object. The browser already decoded both, and a CBOR parser in
 * a privileged console would be a parser nobody needs.
 */

export type CeremonyOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface EnrolmentRequest {
  readonly accountId: string;
  readonly challenge: string;
  readonly label: string;
  readonly relyingPartyId: string;
}

export interface EnrolmentResult {
  readonly algorithm: number;
  readonly attachment?: 'cross_platform' | 'platform';
  readonly authenticatorData: string;
  readonly challenge: string;
  readonly clientDataJSON: string;
  readonly credentialId: string;
  readonly label: string;
  readonly publicKey: string;
}

export interface AssertionRequest {
  readonly challenge: string;
  readonly credentialIds: readonly string[];
  readonly relyingPartyId: string;
}

export interface AssertionResult {
  readonly authenticatorData: string;
  readonly challenge: string;
  readonly clientDataJSON: string;
  readonly credentialId: string;
  readonly signature: string;
}

/** The algorithms the server will verify, offered in the order it prefers. */
const supportedAlgorithms = [-8, -7, -257] as const;

/**
 * Decoded into a fresh `ArrayBuffer` rather than a view over whatever the
 * runtime happened to allocate. The credentials API takes a `BufferSource`
 * whose backing buffer must not be shared, and returning the buffer itself is
 * both simpler and the shape every caller here needs.
 */
function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function encodeBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/**
 * The account identifier as authenticator user handle.
 *
 * The only identifier this console holds, and deliberately so: a name or an
 * address here would put personal data inside a credential stored on a device
 * this platform does not control.
 */
function userHandle(accountId: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(accountId);
  const buffer = new ArrayBuffer(encoded.length);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function available(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined'
  );
}

function refusalReason(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The authenticator was not presented, or the request timed out.';
  }
  if (error instanceof Error && error.name === 'InvalidStateError') {
    return 'This authenticator is already enrolled for this operator.';
  }
  if (error instanceof Error && error.name === 'SecurityError') {
    return 'This origin is not the one the platform expects for this relying party.';
  }
  return 'The authenticator could not complete the request.';
}

export async function enrolAuthenticator(
  request: EnrolmentRequest,
): Promise<CeremonyOutcome<EnrolmentResult>> {
  if (!available()) return { kind: 'unsupported' };
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          // Required rather than preferred. This is the gate in front of every
          // privileged action, and a touch with no verification is not what
          // ADR-0017 asks for — the server refuses one anyway.
          userVerification: 'required',
        },
        challenge: decodeBase64Url(request.challenge),
        pubKeyCredParams: supportedAlgorithms.map((alg) => ({
          alg,
          type: 'public-key' as const,
        })),
        rp: { id: request.relyingPartyId, name: 'Velora Platform Admin' },
        user: {
          displayName: 'Velora operator',
          id: userHandle(request.accountId),
          name: request.accountId,
        },
      },
    })) as PublicKeyCredential | null;
    if (credential === null)
      return { kind: 'refused', reason: refusalReason(undefined) };

    const response = credential.response as AuthenticatorAttestationResponse;
    const publicKey = response.getPublicKey();
    if (publicKey === null) {
      return {
        kind: 'refused',
        reason:
          'This authenticator did not return a public key this platform can verify.',
      };
    }
    const attachment = credential.authenticatorAttachment;
    return {
      kind: 'ok',
      value: {
        algorithm: response.getPublicKeyAlgorithm(),
        ...(attachment === 'platform'
          ? { attachment: 'platform' as const }
          : attachment === 'cross-platform'
            ? { attachment: 'cross_platform' as const }
            : {}),
        authenticatorData: encodeBase64Url(response.getAuthenticatorData()),
        challenge: request.challenge,
        clientDataJSON: encodeBase64Url(response.clientDataJSON),
        credentialId: encodeBase64Url(credential.rawId),
        label: request.label,
        publicKey: encodeBase64Url(publicKey),
      },
    };
  } catch (error) {
    return { kind: 'refused', reason: refusalReason(error) };
  }
}

export async function assertAuthenticator(
  request: AssertionRequest,
): Promise<CeremonyOutcome<AssertionResult>> {
  if (!available()) return { kind: 'unsupported' };
  try {
    const credential = (await navigator.credentials.get({
      publicKey: {
        allowCredentials: request.credentialIds.map((id) => ({
          id: decodeBase64Url(id),
          type: 'public-key' as const,
        })),
        challenge: decodeBase64Url(request.challenge),
        rpId: request.relyingPartyId,
        userVerification: 'required',
      },
    })) as PublicKeyCredential | null;
    if (credential === null) {
      return { kind: 'refused', reason: refusalReason(undefined) };
    }
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      kind: 'ok',
      value: {
        authenticatorData: encodeBase64Url(response.authenticatorData),
        challenge: request.challenge,
        clientDataJSON: encodeBase64Url(response.clientDataJSON),
        credentialId: encodeBase64Url(credential.rawId),
        signature: encodeBase64Url(response.signature),
      },
    };
  } catch (error) {
    return { kind: 'refused', reason: refusalReason(error) };
  }
}
