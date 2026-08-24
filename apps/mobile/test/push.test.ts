import { createConsumerApi } from '@velora/consumer-client';

import {
  createInMemoryInstallationStore,
  createInstallationIdentity,
} from '../src/device/installation';
import { createPushRegistrar } from '../src/push/registration';
import {
  createUnavailableDevicePushTokenSource,
  type DevicePushTokenSource,
  type TokenAcquisition,
} from '../src/push/token';
import { admittedState, createMobileApiDouble } from './support/api-double';

/**
 * The push registration lifecycle, which is where every real defect in a push
 * client lives.
 *
 * The calls themselves are two lines each. What goes wrong is the order they
 * happen in relative to signing out, a provider rotating a token, and two
 * screens asking at the same moment — so that is what is driven here, against
 * the real generated client and the real contract paths.
 *
 * Nothing in this file asserts that a notification is delivered. No provider is
 * approved for VELORA, and registering a token proves only that a token exists
 * and that the server has it.
 */

const installationId = 'android-2b1f4c8a-9d3e-4a7b-8c6d-5e4f3a2b1c0d';
const firstToken = `first-${'t'.repeat(40)}`;
const secondToken = `second-${'t'.repeat(40)}`;

function identity() {
  return createInstallationIdentity({
    generate: () => installationId,
    store: createInMemoryInstallationStore(),
  });
}

/** A source under the test's control, standing in for whatever a provider is. */
function scriptedSource(script: {
  answers: TokenAcquisition[];
}): DevicePushTokenSource & { rotate: (token: string) => void } {
  let rotated: ((token: string) => void) | undefined;
  let index = 0;
  return {
    kind: 'scripted',
    acquire() {
      const answer = script.answers[Math.min(index, script.answers.length - 1)];
      index += 1;
      return Promise.resolve(answer ?? { detail: 'exhausted', kind: 'failed' });
    },
    permission() {
      return Promise.resolve('granted');
    },
    rotate(token) {
      rotated?.(token);
    },
    watch(onRotated) {
      rotated = onRotated;
      return () => {
        rotated = undefined;
      };
    },
  };
}

function harness(source: DevicePushTokenSource) {
  const double = createMobileApiDouble(admittedState());
  const api = createConsumerApi({
    apiBaseUrl: 'http://api.test',
    fetch: double.fetch,
    transport: {
      headers: () => Promise.resolve({ authorization: 'Bearer access-1' }),
    },
  });
  return {
    api,
    double,
    registrar: createPushRegistrar({
      api,
      installation: identity(),
      source,
    }),
  };
}

function registrations(double: ReturnType<typeof createMobileApiDouble>) {
  return double.calls.filter(
    (call) =>
      call.path === '/v1/notifications/devices' && call.method === 'POST',
  );
}

function revocations(double: ReturnType<typeof createMobileApiDouble>) {
  return double.calls.filter(
    (call) =>
      call.path === '/v1/notifications/devices/revocations' &&
      call.method === 'POST',
  );
}

describe('registering this device', () => {
  it('sends the token once and reports the devices the server now holds', async () => {
    const { double, registrar } = harness(
      scriptedSource({ answers: [{ kind: 'acquired', token: firstToken }] }),
    );

    const state = await registrar.ensure();

    expect(state).toEqual({ devices: 1, status: 'registered' });
    expect(registrations(double)).toHaveLength(1);
    expect(registrations(double)[0]?.body).toEqual({
      installationId,
      platform: 'android',
      token: firstToken,
    });
  });

  it('does not send the same token again on a later foreground', async () => {
    const { double, registrar } = harness(
      scriptedSource({
        answers: [
          { kind: 'acquired', token: firstToken },
          { kind: 'acquired', token: firstToken },
          { kind: 'acquired', token: firstToken },
        ],
      }),
    );

    await registrar.ensure();
    await registrar.ensure();
    await registrar.ensure();

    // The server treats a repeat as a heartbeat, so this is safe rather than
    // wrong — but a request per glance at the phone buys no new fact.
    expect(registrations(double)).toHaveLength(1);
  });

  it('shares one attempt between callers arriving together', async () => {
    const { double, registrar } = harness(
      scriptedSource({ answers: [{ kind: 'acquired', token: firstToken }] }),
    );

    await Promise.all([
      registrar.ensure(),
      registrar.ensure(),
      registrar.ensure(),
    ]);

    expect(registrations(double)).toHaveLength(1);
  });

  it('sends the replacement when the provider rotates the token', async () => {
    const source = scriptedSource({
      answers: [{ kind: 'acquired', token: firstToken }],
    });
    const { double, registrar } = harness(source);
    await registrar.ensure();
    const stop = registrar.watch();

    source.rotate(secondToken);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();

    expect(registrations(double)).toHaveLength(2);
    expect(registrations(double)[1]?.body).toMatchObject({
      token: secondToken,
    });
  });
});

describe('the ways registering does not happen', () => {
  it('reports a build with no provider without asking for a permission', async () => {
    const { double, registrar } = harness(
      createUnavailableDevicePushTokenSource(),
    );

    const state = await registrar.ensure({ requestPermission: true });

    expect(state.status).toBe('provider_unavailable');
    // Nothing was registered, and — the point — no prompt was raised for a
    // capability that does not exist.
    expect(registrations(double)).toHaveLength(0);
  });

  it('separates a refused permission from one Android will not ask about', async () => {
    for (const permission of ['denied', 'blocked'] as const) {
      const { registrar } = harness(
        scriptedSource({
          answers: [{ kind: 'permission_required', permission }],
        }),
      );
      const state = await registrar.ensure();
      expect(state).toEqual({ permission, status: 'permission_required' });
    }
  });

  it('leaves a network failure retryable rather than pretending it registered', async () => {
    const { double, registrar } = harness(
      scriptedSource({
        answers: [
          { kind: 'acquired', token: firstToken },
          { kind: 'acquired', token: firstToken },
        ],
      }),
    );
    double.failNext('/v1/notifications/devices');

    const failed = await registrar.ensure();
    expect(failed.status).toBe('failed');

    // The next foreground tries again, and the token is re-sent because the
    // server never acknowledged it.
    const recovered = await registrar.ensure();
    expect(recovered).toEqual({ devices: 1, status: 'registered' });
  });
});

describe('signing out', () => {
  it('revokes by installation, so it works with no token in hand', async () => {
    const { double, registrar } = harness(
      createUnavailableDevicePushTokenSource(),
    );

    const state = await registrar.revoke();

    expect(state).toEqual({ status: 'idle' });
    expect(revocations(double)).toHaveLength(1);
    expect(revocations(double)[0]?.body).toEqual({ installationId });
  });

  it('clears local state even when the server cannot be reached', async () => {
    const { double, registrar } = harness(
      scriptedSource({ answers: [{ kind: 'acquired', token: firstToken }] }),
    );
    await registrar.ensure();
    double.failNext('/v1/notifications/devices/revocations');

    await expect(registrar.revoke()).resolves.toEqual({ status: 'idle' });
  });

  it('does not let a rotation arriving mid-sign-out re-register the device', async () => {
    const source = scriptedSource({
      answers: [{ kind: 'acquired', token: firstToken }],
    });
    const { double, registrar } = harness(source);
    await registrar.ensure();
    const stop = registrar.watch();

    await registrar.revoke();
    // The provider hands over a new token just after the person signed out.
    source.rotate(secondToken);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();

    // Registering it would put a live registration back on an account that has
    // signed out, and the next notice would ring a phone nobody is signed in
    // on. Only the first registration ever happened.
    expect(registrations(double)).toHaveLength(1);
    expect(revocations(double)).toHaveLength(1);
  });

  it('undoes a registration that lands after the sign-out it raced', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source: DevicePushTokenSource = {
      kind: 'slow',
      async acquire() {
        await gate;
        return { kind: 'acquired', token: firstToken };
      },
      permission: () => Promise.resolve('granted'),
      watch: () => () => undefined,
    };
    const { double, registrar } = harness(source);

    const pending = registrar.ensure();
    await registrar.revoke();
    release?.();
    await pending;

    // The acquisition was already in flight when the sign-out landed, so it
    // must publish nothing. The state stays where the revocation left it.
    expect(registrar.state).toEqual({ status: 'idle' });
    expect(registrations(double)).toHaveLength(0);
  });
});
