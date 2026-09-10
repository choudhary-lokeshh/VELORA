import { describe, expect, it } from 'bun:test';

import {
  forwardedClientAddress,
  requesterReferenceResolver,
} from '../../src/http/forwarded.js';

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://api.velora.test/v1/health/live', { headers });
}

describe('forwarded client address', () => {
  it('ignores the header entirely when no proxy is configured', () => {
    expect(
      forwardedClientAddress(
        requestWith({ 'x-forwarded-for': '203.0.113.7' }),
        0,
      ),
    ).toBeUndefined();
  });

  it('reads the address the one trusted proxy observed', () => {
    expect(
      forwardedClientAddress(
        requestWith({ 'x-forwarded-for': '203.0.113.7' }),
        1,
      ),
    ).toBe('203.0.113.7');
  });

  it('refuses to be moved by entries a client prepended', () => {
    // The client wrote the first two; the proxy appended the third. With one
    // proxy configured, the third is the only one this platform believes.
    expect(
      forwardedClientAddress(
        requestWith({
          'x-forwarded-for': '10.0.0.1, 198.51.100.9, 203.0.113.7',
        }),
        1,
      ),
    ).toBe('203.0.113.7');
  });

  it('reads two hops from the right when two proxies are configured', () => {
    expect(
      forwardedClientAddress(
        requestWith({
          'x-forwarded-for': '203.0.113.7, 198.51.100.9',
        }),
        2,
      ),
    ).toBe('203.0.113.7');
  });

  it('attributes nothing when the header is shorter than the topology', () => {
    // Fewer entries than hops means this did not arrive through the proxies the
    // deployment described. Reading the leftmost anyway is the bypass.
    expect(
      forwardedClientAddress(
        requestWith({ 'x-forwarded-for': '203.0.113.7' }),
        2,
      ),
    ).toBeUndefined();
  });

  it('attributes nothing to a header long enough to be an attack', () => {
    const entries = Array.from(
      { length: 40 },
      (_, index) => `10.0.0.${String(index)}`,
    );
    expect(
      forwardedClientAddress(
        requestWith({ 'x-forwarded-for': entries.join(', ') }),
        1,
      ),
    ).toBeUndefined();
  });
});

describe('requester reference', () => {
  it('falls back to the device a client supplies when no proxy is configured', () => {
    const resolve = requesterReferenceResolver({ trustedProxyHopCount: 0 });
    expect(
      resolve(
        requestWith({
          'x-forwarded-for': '203.0.113.7',
          'x-velora-device': 'device-one',
        }),
      ),
    ).toBe('device:device-one');
  });

  it('prefers the observed address behind a configured proxy', () => {
    const resolve = requesterReferenceResolver({ trustedProxyHopCount: 1 });
    expect(
      resolve(
        requestWith({
          'x-forwarded-for': '203.0.113.7',
          'x-velora-device': 'device-one',
        }),
      ),
    ).toBe('ip:203.0.113.7');
  });

  it('shares one bucket for a caller that identifies itself in no way', () => {
    const resolve = requesterReferenceResolver({ trustedProxyHopCount: 1 });
    expect(resolve(requestWith({}))).toBe('unattributed');
  });
});
