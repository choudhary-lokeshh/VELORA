import {
  createInMemoryInstallationStore,
  createInstallationIdentity,
} from '../src/device/installation';
import {
  permissionExplanation,
  readPermissionState,
  wasAsked,
} from '../src/device/permissions';

/**
 * The two device facts everything native is built on: what this installation
 * is called, and what Android has said about a permission.
 *
 * Both used to be wrong in ways nothing could catch. Every device in the world
 * sent the same installation identifier, and the two "no" answers Android
 * gives were treated as one.
 */

const usable = /^android-[0-9a-f-]{36}$/u;

describe('the installation identifier', () => {
  it('is minted once and then reused, whatever asks for it', async () => {
    const store = createInMemoryInstallationStore();
    const identity = createInstallationIdentity({ store });

    const first = await identity.current();
    const second = await identity.current();

    expect(first).toMatch(usable);
    expect(second).toBe(first);
    // The stricter of the two contracts: 8-128 characters of [A-Za-z0-9._-].
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(first).toMatch(/^[A-Za-z0-9._-]+$/u);
  });

  it('mints one identifier for callers arriving in the same frame', async () => {
    let minted = 0;
    const identity = createInstallationIdentity({
      generate: () => {
        minted += 1;
        return `android-2b1f4c8a-9d3e-4a7b-8c6d-5e4f3a2b1c0${String(minted)}`;
      },
      store: createInMemoryInstallationStore(),
    });

    // A cold launch asks from the session restore and from the push registrar
    // at once. Two identifiers would mean the server was told about a device
    // that then stopped existing.
    const [a, b, c] = await Promise.all([
      identity.current(),
      identity.current(),
      identity.current(),
    ]);

    expect(minted).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps the stored identifier across a restart', async () => {
    const store = createInMemoryInstallationStore();
    const first = await createInstallationIdentity({ store }).current();
    // A second process, the same device.
    const second = await createInstallationIdentity({ store }).current();

    expect(second).toBe(first);
  });

  it('replaces a stored value the contracts would refuse', async () => {
    // What an older build wrote, and what the server rejects at validation.
    const store = createInMemoryInstallationStore({
      initial: 'installation-local-device',
    });
    const identity = createInstallationIdentity({ store });

    const current = await identity.current();

    expect(current).not.toBe('installation-local-device');
    expect(current).toMatch(usable);
  });

  it('still answers when the keystore will not accept a write', async () => {
    const identity = createInstallationIdentity({
      store: createInMemoryInstallationStore({ failWrites: true }),
    });

    // Degrading to a per-launch identifier is survivable. Refusing to produce
    // one would stop somebody signing in at all.
    await expect(identity.current()).resolves.toMatch(usable);
  });
});

describe('a permission answer', () => {
  it('separates a refusal from a refusal Android will not ask about again', () => {
    expect(readPermissionState({ canAskAgain: true, status: 'denied' })).toBe(
      'denied',
    );
    // The distinction the whole permission model turns on: calling `request`
    // here returns instantly with nothing on screen, so a product that keeps
    // calling it has built a button that does nothing.
    expect(readPermissionState({ canAskAgain: false, status: 'denied' })).toBe(
      'blocked',
    );
  });

  it('reads granted from either shape the modules return', () => {
    expect(readPermissionState({ granted: true })).toBe('granted');
    expect(readPermissionState({ status: 'granted' })).toBe('granted');
  });

  it('treats an absent answer as a capability that does not exist', () => {
    // A build with no such module answers `undefined`, and there is nothing a
    // person can do about that — so it must not be reported as `blocked`,
    // which would send them to a Settings screen with no switch on it.
    expect(readPermissionState(undefined)).toBe('unavailable');
  });

  it('reports undetermined as something still worth asking', () => {
    expect(readPermissionState({ status: 'undetermined' })).toBe('denied');
    expect(wasAsked({ status: 'undetermined' })).toBe(false);
    expect(wasAsked({ canAskAgain: false, status: 'denied' })).toBe(true);
  });

  it('explains each refusal differently, and says nothing when granted', () => {
    expect(permissionExplanation('granted', 'camera')).toBeUndefined();
    expect(permissionExplanation('blocked', 'camera')).toContain('Settings');
    expect(permissionExplanation('denied', 'camera')).not.toContain('Settings');
    expect(permissionExplanation('unavailable', 'notifications')).toContain(
      'cannot',
    );
  });
});
