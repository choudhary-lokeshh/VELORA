/**
 * Who a request is from, for abuse control, behind zero or more proxies.
 *
 * `X-Forwarded-For` is a header any client can send. A platform that reads its
 * leftmost entry hands every caller a free rate-limit bypass — write whatever
 * you like and be somebody new each request. A platform that ignores it behind
 * a proxy is the opposite failure: every request appears to come from the
 * proxy, so one abusive caller exhausts the bucket everybody shares.
 *
 * The correct read is neither, and it is not derivable from the request. A
 * proxy appends the address it saw, so with exactly `n` proxies in front, the
 * address the outermost one saw is the entry `n` from the right, and everything
 * to the left of it was written by somebody this platform has no reason to
 * believe. `n` is deployment topology, which is why configuration states it as
 * a count rather than a boolean.
 *
 * Zero means the header is not read at all. That is the default and the only
 * safe answer for a process a client can reach directly.
 */

const maximumForwardedEntries = 32;

export interface RequesterReferenceOptions {
  /** Exactly how many reverse proxies sit in front of this process. */
  readonly trustedProxyHopCount: number;
}

/**
 * The device reference a client supplies.
 *
 * ADR-0017 permits an "IP or device baseline", and a caller that supplies
 * neither shares one bucket rather than getting an unlimited private one.
 */
function deviceReference(request: Request): string {
  const device = request.headers.get('x-velora-device');
  return device !== null && device.length > 0
    ? `device:${device}`
    : 'unattributed';
}

/**
 * The address the outermost trusted proxy actually observed, when the topology
 * says there is one and the header is well formed enough to read.
 */
export function forwardedClientAddress(
  request: Request,
  trustedProxyHopCount: number,
): string | undefined {
  if (trustedProxyHopCount <= 0) return undefined;
  const header = request.headers.get('x-forwarded-for');
  if (header === null) return undefined;
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  // A header long enough to be an attack on the parser is not one to reason
  // about; the request simply has no attributable address.
  if (entries.length === 0 || entries.length > maximumForwardedEntries) {
    return undefined;
  }
  // Fewer entries than hops means the header did not come through the topology
  // this deployment described. Reading the leftmost one anyway is exactly the
  // bypass this function exists to prevent.
  if (entries.length < trustedProxyHopCount) return undefined;
  const address = entries[entries.length - trustedProxyHopCount];
  if (address === undefined || address.length > 64) return undefined;
  // Deliberately not parsed into an IP. The value is a bucket key and nothing
  // else: it is never compared to an allowlist, never logged as a location, and
  // never used for any decision but "how many requests has this made".
  return address;
}

export function requesterReferenceResolver(
  options: RequesterReferenceOptions,
): (request: Request) => string {
  return (request) => {
    const address = forwardedClientAddress(
      request,
      options.trustedProxyHopCount,
    );
    if (address !== undefined) return `ip:${address}`;
    return deviceReference(request);
  };
}
