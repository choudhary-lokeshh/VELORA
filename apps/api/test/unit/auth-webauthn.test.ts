import { describe, expect, it } from 'bun:test';
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  type KeyObject,
} from 'node:crypto';

import { WebAuthnAuthenticatorVerifier } from '../../src/auth/webauthn.js';

/**
 * A real authenticator, in as many bytes as the ceremony actually needs.
 *
 * The point of building one here rather than recording a fixture is that every
 * refusal below can be produced by changing exactly one thing — the origin, the
 * challenge, a flag, one byte of the signature — while everything else stays a
 * genuinely valid ceremony. A recorded blob proves the happy path and nothing
 * about which check rejected the rest.
 */
const relyingPartyId = 'velora.test';
const origin = 'https://admin.velora.test';

interface Authenticator {
  readonly publicKey: string;
  sign(input: {
    readonly challenge: string;
    readonly flags?: number;
    readonly relyingParty?: string;
    readonly signCount: number;
    readonly type: string;
    readonly origin?: string;
  }): {
    readonly authenticatorData: string;
    readonly clientDataJSON: string;
    readonly signature: string;
  };
}

function authenticatorFor(
  kind: 'ed25519' | 'ec',
  privateKey: KeyObject,
  publicKeyDer: Buffer,
): Authenticator {
  return {
    publicKey: publicKeyDer.toString('base64url'),
    sign(input) {
      const authenticatorData = Buffer.alloc(37);
      createHash('sha256')
        .update(input.relyingParty ?? relyingPartyId, 'utf8')
        .digest()
        .copy(authenticatorData, 0);
      authenticatorData[32] = input.flags ?? 0x05;
      authenticatorData.writeUInt32BE(input.signCount, 33);

      const clientData = Buffer.from(
        JSON.stringify({
          challenge: input.challenge,
          origin: input.origin ?? origin,
          type: input.type,
        }),
        'utf8',
      );
      const message = Buffer.concat([
        authenticatorData,
        createHash('sha256').update(clientData).digest(),
      ]);
      const signature =
        kind === 'ed25519'
          ? signBytes(null, message, privateKey)
          : signBytes('sha256', message, privateKey);
      return {
        authenticatorData: authenticatorData.toString('base64url'),
        clientDataJSON: clientData.toString('base64url'),
        signature: signature.toString('base64url'),
      };
    },
  };
}

function ed25519Authenticator(): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return authenticatorFor(
    'ed25519',
    privateKey,
    publicKey.export({ format: 'der', type: 'spki' }),
  );
}

function ecAuthenticator(): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return authenticatorFor(
    'ec',
    privateKey,
    publicKey.export({ format: 'der', type: 'spki' }),
  );
}

const verifier = new WebAuthnAuthenticatorVerifier({
  origins: [origin],
  relyingPartyId,
});

describe('WebAuthn assertion verification', () => {
  it('accepts an Ed25519 assertion over the exact challenge and origin', async () => {
    const authenticator = ed25519Authenticator();
    const assertion = authenticator.sign({
      challenge: 'challenge-one',
      signCount: 7,
      type: 'webauthn.get',
    });
    expect(
      await verifier.verify({
        assertion: { ...assertion, credentialId: 'Y3JlZA' },
        challenge: 'challenge-one',
        publicKey: authenticator.publicKey,
      }),
    ).toEqual({ countersSupported: true, signCount: 7 });
  });

  it('accepts an ES256 assertion and reports a counterless authenticator', async () => {
    const authenticator = ecAuthenticator();
    const assertion = authenticator.sign({
      challenge: 'challenge-two',
      signCount: 0,
      type: 'webauthn.get',
    });
    expect(
      await verifier.verify({
        assertion: { ...assertion, credentialId: 'Y3JlZA' },
        challenge: 'challenge-two',
        publicKey: authenticator.publicKey,
      }),
    ).toEqual({ countersSupported: false, signCount: 0 });
  });

  it.each([
    [
      'a challenge this server did not issue',
      { challenge: 'not-the-challenge' },
      {},
    ],
    ['an origin outside the allowlist', {}, { origin: 'https://evil.example' }],
    ['a relying party that is not this one', {}, { relyingParty: 'evil.test' }],
    ['an authenticator that saw nobody', {}, { flags: 0x00 }],
    ['a touch with no user verification', {}, { flags: 0x01 }],
    [
      'a registration replayed as an assertion',
      {},
      { type: 'webauthn.create' },
    ],
  ])('refuses %s', async (_name, overrides, signOverrides) => {
    const authenticator = ed25519Authenticator();
    const assertion = authenticator.sign({
      challenge: 'challenge-three',
      signCount: 4,
      type: 'webauthn.get',
      ...signOverrides,
    });
    expect(
      await verifier.verify({
        assertion: { ...assertion, credentialId: 'Y3JlZA' },
        challenge: 'challenge-three',
        publicKey: authenticator.publicKey,
        ...overrides,
      }),
    ).toBeUndefined();
  });

  it('refuses an assertion signed by a different credential', async () => {
    const authenticator = ed25519Authenticator();
    const other = ed25519Authenticator();
    const assertion = authenticator.sign({
      challenge: 'challenge-four',
      signCount: 1,
      type: 'webauthn.get',
    });
    expect(
      await verifier.verify({
        assertion: { ...assertion, credentialId: 'Y3JlZA' },
        challenge: 'challenge-four',
        publicKey: other.publicKey,
      }),
    ).toBeUndefined();
  });

  it('refuses a tampered signature', async () => {
    const authenticator = ed25519Authenticator();
    const assertion = authenticator.sign({
      challenge: 'challenge-five',
      signCount: 1,
      type: 'webauthn.get',
    });
    const bytes = Buffer.from(assertion.signature, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(
      await verifier.verify({
        assertion: {
          ...assertion,
          credentialId: 'Y3JlZA',
          signature: bytes.toString('base64url'),
        },
        challenge: 'challenge-five',
        publicKey: authenticator.publicKey,
      }),
    ).toBeUndefined();
  });
});

describe('WebAuthn registration verification', () => {
  it('accepts an enrolment and returns the credential to store', async () => {
    const authenticator = ed25519Authenticator();
    const created = authenticator.sign({
      challenge: 'enrol-one',
      signCount: 3,
      type: 'webauthn.create',
    });
    expect(
      await verifier.register({
        challenge: 'enrol-one',
        registration: {
          algorithm: -8,
          authenticatorData: created.authenticatorData,
          clientDataJSON: created.clientDataJSON,
          credentialId: 'Y3JlZA',
          publicKey: authenticator.publicKey,
        },
      }),
    ).toEqual({
      credentialId: 'Y3JlZA',
      publicKey: authenticator.publicKey,
      signCount: 3,
    });
  });

  it('refuses an algorithm this platform will not verify', async () => {
    const authenticator = ed25519Authenticator();
    const created = authenticator.sign({
      challenge: 'enrol-two',
      signCount: 1,
      type: 'webauthn.create',
    });
    expect(
      await verifier.register({
        challenge: 'enrol-two',
        registration: {
          algorithm: -65_535,
          authenticatorData: created.authenticatorData,
          clientDataJSON: created.clientDataJSON,
          credentialId: 'Y3JlZA',
          publicKey: authenticator.publicKey,
        },
      }),
    ).toBeUndefined();
  });

  it('refuses a public key it could never verify with', async () => {
    const authenticator = ed25519Authenticator();
    const created = authenticator.sign({
      challenge: 'enrol-three',
      signCount: 1,
      type: 'webauthn.create',
    });
    expect(
      await verifier.register({
        challenge: 'enrol-three',
        registration: {
          algorithm: -8,
          authenticatorData: created.authenticatorData,
          clientDataJSON: created.clientDataJSON,
          credentialId: 'Y3JlZA',
          publicKey: 'bm90LWEta2V5',
        },
      }),
    ).toBeUndefined();
  });
});
