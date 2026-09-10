/* eslint-disable no-restricted-globals -- This module is the approved outbound HTTP adapter. It is the one place in the backend that owns `fetch`, which is exactly what makes the rule elsewhere enforceable. See docs/security/06-abuse-outbound-networking.md. */
import { lookup } from 'node:dns/promises';

import type {
  OutboundHttpPort,
  OutboundRequest,
  OutboundResponse,
} from './ports.js';

/**
 * The one adapter that performs outbound HTTP.
 *
 * Backend source may not touch `fetch` or a socket module — ESLint and the
 * boundary parser enforce that across every workspace the runtime can import —
 * and this file is the single, reviewable exception. Everything else in the
 * platform reaches the network by being handed this port, which means the
 * transport rules below are not a convention any caller can forget.
 *
 * What it enforces, and why each one is here rather than in a caller:
 *
 * - **TLS**, except on loopback in local and test. A deployed environment that
 *   fetched over `http:` would put a client secret on the wire.
 * - **No redirects.** A redirect is a second destination nobody validated, and
 *   re-validating at every hop is a contract this port would rather not have.
 * - **Resolved-address validation.** Every address a hostname resolves to must
 *   be a public one: loopback, private, link-local, unique-local,
 *   carrier-grade NAT, multicast, and the cloud metadata address are all
 *   refused. That is the SSRF rule from the outbound-networking authority.
 * - **Bounded time and bytes.** A destination that answers slowly, or forever,
 *   must not be able to hold a request open or exhaust memory.
 * - **No ambient credentials.** Cookies are never sent, and a URL carrying
 *   credentials is refused outright rather than stripped, because a caller that
 *   built one meant something this port will not do.
 *
 * What it deliberately does not do is decide *where* a caller may go. Choosing
 * a destination is a capability decision that belongs to the provider adapter
 * making it, and every current caller derives its destinations from deployment
 * configuration rather than from anything a request carried.
 *
 * One residual risk is recorded rather than hidden: addresses are validated and
 * then the connection is made by name, so a hostile authoritative DNS server
 * could answer differently for the two lookups. Pinning the connection to a
 * validated address needs a custom agent that neither Bun's nor Node's `fetch`
 * exposes. It matters little for the destinations this platform actually has —
 * they come from a deployment's own configuration, not from callers — and it is
 * named here so a future caller that takes a destination from a request knows
 * this port is not enough on its own.
 */

const defaultTimeoutMilliseconds = 10_000;
const defaultMaximumResponseBytes = 1_048_576;

export interface AllowlistedOutboundHttpOptions {
  /**
   * Whether loopback destinations are permitted. True only in local and test,
   * where a contract harness stands a provider up in this process.
   */
  readonly allowLoopback: boolean;
  readonly maximumResponseBytes?: number;
  readonly timeoutMilliseconds?: number;
}

/**
 * What a host string is, decided here rather than by `node:net`.
 *
 * The socket modules are the primitives this platform forbids, and reaching for
 * one to answer "is this an IP literal" would put a restricted import in the
 * module whose whole job is to be the one place that does not need one.
 */
const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

function addressFamily(value: string): 'hostname' | 'ipv4' | 'ipv6' {
  if (ipv4Pattern.test(value)) return 'ipv4';
  // Every IPv6 textual form contains a colon and no hostname may, so the
  // presence of one is a complete test rather than an approximation.
  return value.includes(':') ? 'ipv6' : 'hostname';
}

/** Addresses no outbound request may reach, whatever a hostname resolves to. */
function isForbiddenAddress(address: string): boolean {
  const family = addressFamily(address);
  if (family === 'ipv4') return isForbiddenIpv4(address);
  if (family === 'ipv6')
    return isForbiddenIpv6(address.replace(/^\[|\]$/gu, ''));
  return true;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  const [first = 0, second = 0] = parts;
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true; // link-local and metadata
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true; // CGNAT
  if (first >= 224) return true; // multicast and reserved
  return false;
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true; // multicast
  // An IPv4-mapped address is an IPv4 address wearing a different spelling, and
  // reading it as opaque is how a loopback slips through this check.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(normalized);
  if (mapped?.[1] !== undefined) return isForbiddenIpv4(mapped[1]);
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)
  );
}

export class AllowlistedOutboundHttp implements OutboundHttpPort {
  constructor(private readonly options: AllowlistedOutboundHttpOptions) {}

  async execute(request: OutboundRequest): Promise<OutboundResponse> {
    const { url } = request;
    if (url.username !== '' || url.password !== '') {
      throw new Error('Outbound URL must not carry credentials');
    }
    const loopback = isLoopbackHostname(url.hostname);
    if (loopback && !this.options.allowLoopback) {
      throw new Error('Outbound loopback destinations are not permitted');
    }
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
      throw new Error('Outbound requests must use https');
    }
    if (!loopback) await this.requirePublicAddresses(url.hostname);

    const controller = AbortSignal.timeout(
      this.options.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
    );
    const response = await fetch(url, {
      // Cookies are never sent: this port carries only credentials a caller
      // placed in a header deliberately.
      credentials: 'omit',
      headers: request.headers,
      method: request.method,
      redirect: 'error',
      signal: controller,
      ...(request.body === undefined ? {} : { body: request.body }),
    });

    const maximum =
      this.options.maximumResponseBytes ?? defaultMaximumResponseBytes;
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maximum) {
      throw new Error('Outbound response exceeded the permitted size');
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of response.headers.entries()) {
      headers[name.toLowerCase()] = value;
    }
    return { body, headers, status: response.status };
  }

  private async requirePublicAddresses(hostname: string): Promise<void> {
    if (addressFamily(hostname) !== 'hostname') {
      if (isForbiddenAddress(hostname)) {
        throw new Error('Outbound destination resolves to a reserved address');
      }
      return;
    }
    const resolved = (await lookup(hostname, {
      all: true,
      verbatim: true,
    })) as readonly { readonly address: string }[];
    if (resolved.length === 0) {
      throw new Error('Outbound destination did not resolve');
    }
    for (const entry of resolved) {
      if (isForbiddenAddress(entry.address)) {
        throw new Error('Outbound destination resolves to a reserved address');
      }
    }
  }
}
