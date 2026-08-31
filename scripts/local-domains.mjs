import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The local development domain topology, declared once.
 *
 * `bun run dev` serves the three surfaces on loopback ports and the API on a
 * fourth, which works because a cookie is scoped to a host and ignores the
 * port: everything shares `127.0.0.1`, so the CSRF companion cookie the API
 * sets is readable by the script of every surface, and one API origin is named
 * in every surface's Content-Security-Policy. Give each surface its own
 * hostname and both of those stop being true at once.
 *
 * So the domains are not three names pointed at three ports. Each surface is
 * served at its own hostname *together with the API*, which keeps every fact
 * the loopback topology relied on:
 *
 *   https://velora.local/         and /v1/*  -> Consumer Web  + API
 *   https://studio.velora.local/  and /v1/*  -> Creator Studio + API
 *   https://admin.velora.local/   and /v1/*  -> Platform Admin + API
 *
 * `__Host-` session and CSRF cookies are then set on the hostname the browser
 * is already on, host-only per surface, which is what ADR-0009 chose over one
 * cross-subdomain cookie. Nothing about the cookie attributes changes: they
 * require a trustworthy origin, which is why this is TLS and not plain HTTP —
 * `.local` is not `localhost` and a browser will silently drop a `Secure`
 * cookie set over `http://velora.local`.
 *
 * Media is the one fact that does not follow the surface. The `local-test`
 * storage adapter issues absolute addresses from a single configured API base
 * URL, so the bytes come from one origin no matter which surface asked. That
 * origin is named to the other surfaces as their media delivery origin, which
 * is the value `browserSecurityHeaders` already anticipated needing the day an
 * approved provider brings an origin of its own.
 *
 * Nothing here runs unless a developer asks for it with `bun run dev:domains`.
 * `bun run dev` is untouched, so a stale hosts file or a stopped proxy can
 * never be the reason local development does not start.
 */

/** Where certificates and the generated proxy configuration live, off-tree. */
export const localDomainDirectory = join(homedir(), '.velora', 'local-domains');
export const certificateFile = join(localDomainDirectory, 'velora-local.pem');
export const certificateKeyFile = join(
  localDomainDirectory,
  'velora-local-key.pem',
);
export const proxyConfigurationFile = join(localDomainDirectory, 'Caddyfile');

export const loopbackHost = '127.0.0.1';
export const apiPort = 4000;

/**
 * The API paths the proxy hands to the API rather than to the surface.
 *
 * `/v1` is the published contract. `/local-test` is the development storage
 * transport, which is deliberately outside `/v1` because a provider's upload
 * endpoint is not Velora's contract; it exists only when `MEDIA_STORAGE_PROVIDER`
 * is `local-test`, and proxying a path the API does not serve costs nothing.
 */
export const apiPaths = ['/v1/*', '/local-test/*'];

/**
 * One entry per browser surface. `port` is what that workspace's own `dev`
 * script binds, so changing a port stays a single edit in that workspace and
 * one here.
 */
export const localDomainSurfaces = [
  {
    browserOriginsVariable: 'AUTH_BROWSER_ORIGINS_CONSUMER_WEB',
    hostname: 'velora.local',
    label: 'web',
    name: 'Consumer Web',
    port: 3000,
    rendersMedia: true,
  },
  {
    browserOriginsVariable: 'AUTH_BROWSER_ORIGINS_CREATOR_STUDIO',
    hostname: 'studio.velora.local',
    label: 'creator-studio',
    name: 'Creator Studio',
    port: 3001,
    rendersMedia: true,
  },
  {
    browserOriginsVariable: 'AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN',
    hostname: 'admin.velora.local',
    label: 'admin',
    name: 'Platform Admin',
    port: 3002,
    // Platform Admin renders no media bytes: an operator reads records, not
    // photographs. It is therefore not told the delivery origin, because a
    // console with the tightest policy on the platform should not carry an
    // allowance nothing on it uses.
    rendersMedia: false,
  },
];

/**
 * The origin the `local-test` adapter issues media addresses on.
 *
 * One value, because one API process holds one `VELORA_API_BASE_URL`. Consumer
 * Web's origin is the one chosen: it is the surface most media is rendered on,
 * so it is the surface for which the delivery origin and the API origin are the
 * same and no extra Content-Security-Policy allowance exists at all.
 */
export const mediaDeliveryHostname = 'velora.local';

export const mediaDeliveryOrigin = `https://${mediaDeliveryHostname}`;

/** Every hostname the certificate, the hosts file, and the proxy must agree on. */
export function domainHostnames() {
  return localDomainSurfaces.map((surface) => surface.hostname);
}

export function originFor(surface) {
  return `https://${surface.hostname}`;
}

/* ============================ Proxy configuration ==================== */

/**
 * The Caddy configuration, generated from the table above on every start.
 *
 * Generated rather than committed for the same reason the table exists: a
 * hostname or a port written twice is a hostname or a port that will disagree
 * with itself. It is written outside the repository, next to the key it names,
 * because a proxy configuration holding a path to a private key is not a file
 * to leave lying in a working tree.
 */
export function proxyConfiguration() {
  const blocks = localDomainSurfaces.map((surface) =>
    [
      `${surface.hostname} {`,
      `\ttls ${certificateFile} ${certificateKeyFile}`,
      '',
      `\t@api path ${apiPaths.join(' ')}`,
      '\thandle @api {',
      `\t\treverse_proxy ${loopbackHost}:${String(apiPort)}`,
      '\t}',
      '',
      '\thandle {',
      `\t\treverse_proxy ${loopbackHost}:${String(surface.port)}`,
      '\t}',
      '}',
    ].join('\n'),
  );
  return [
    '# Generated by `bun run dev:domains` from scripts/local-domains.mjs.',
    '# Rewritten on every start; edit the script, not this file.',
    '',
    '{',
    '\tadmin off',
    '\tpersist_config off',
    '\tlog {',
    '\t\t# The dev log is four processes deep already; a line per asset request',
    '\t\t# would bury the ones a developer is reading.',
    '\t\toutput discard',
    '\t}',
    '}',
    '',
    ...blocks,
    '',
  ].join('\n');
}

export function writeProxyConfiguration() {
  mkdirSync(localDomainDirectory, { recursive: true });
  writeFileSync(proxyConfigurationFile, proxyConfiguration());
  return proxyConfigurationFile;
}

/* ================================ Preflight ========================== */

function binaryOnPath(name) {
  return spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
}

/** The `127.0.0.1` names `/etc/hosts` actually declares. */
export function hostsFileNames() {
  let source = '';
  try {
    source = readFileSync('/etc/hosts', 'utf8');
  } catch {
    return new Set();
  }
  const names = new Set();
  for (const line of source.split('\n')) {
    const withoutComment = line.split('#')[0] ?? '';
    const fields = withoutComment.trim().split(/\s+/u).filter(Boolean);
    const [address, ...aliases] = fields;
    if (address !== loopbackHost && address !== '::1') continue;
    for (const alias of aliases) names.add(alias);
  }
  return names;
}

export function missingHostsEntries() {
  const declared = hostsFileNames();
  return domainHostnames().filter((hostname) => !declared.has(hostname));
}

/** The line a developer adds to `/etc/hosts`, written out for them to paste. */
export function hostsFileLine() {
  return `${loopbackHost}\t${domainHostnames().join(' ')}`;
}

/**
 * Whether mkcert's root certificate is in a trust store.
 *
 * `mkcert -install` is the only step here that needs a password, and it is left
 * to the developer to run deliberately: adding a certificate authority to a
 * machine's trust store is not something a `dev` command should do on somebody's
 * behalf. This only reports whether it has happened.
 */
export function certificateAuthorityInstalled() {
  const root = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8' });
  if (root.status !== 0) return { installed: false, reason: 'mkcert-missing' };
  const rootCertificate = join(root.stdout.trim(), 'rootCA.pem');
  if (!existsSync(rootCertificate)) {
    return { installed: false, reason: 'no-root' };
  }
  if (process.platform !== 'darwin') {
    // Only macOS is verified here, because only its trust store can be read
    // without a password. Elsewhere the root certificate existing is all this
    // can honestly claim, and `mkcert -install` is idempotent anyway.
    return { installed: true, rootCertificate };
  }
  const trusted = spawnSync(
    'security',
    [
      'find-certificate',
      '-c',
      'mkcert',
      '-a',
      '/Library/Keychains/System.keychain',
    ],
    { encoding: 'utf8' },
  );
  return trusted.status === 0 && trusted.stdout.includes('mkcert')
    ? { installed: true, rootCertificate }
    : { installed: false, reason: 'not-trusted', rootCertificate };
}

/** Whether the certificate on disk still covers every name, and has not expired. */
export function certificateCovers(hostnames) {
  if (!existsSync(certificateFile) || !existsSync(certificateKeyFile)) {
    return false;
  }
  const text = spawnSync(
    'openssl',
    ['x509', '-in', certificateFile, '-noout', '-text', '-checkend', '86400'],
    { encoding: 'utf8' },
  );
  if (text.status !== 0) return false;
  return hostnames.every((hostname) =>
    new RegExp(`DNS:${hostname.replaceAll('.', '\\.')}(,|\\s|$)`, 'u').test(
      text.stdout,
    ),
  );
}

/**
 * Issues the certificate, which needs no password: `mkcert -install` already
 * placed the authority, and signing a leaf with it is an ordinary file write.
 */
export function issueCertificate() {
  mkdirSync(localDomainDirectory, { recursive: true });
  return spawnSync(
    'mkcert',
    [
      '-cert-file',
      certificateFile,
      '-key-file',
      certificateKeyFile,
      ...domainHostnames(),
    ],
    { encoding: 'utf8' },
  );
}

/**
 * Everything that must be true before the proxy can serve, and the exact
 * command that makes each true when it is not.
 *
 * Returned rather than printed, so the one caller decides how a refusal reads,
 * and so nothing here exits a process it does not own.
 */
export function preflight() {
  const problems = [];

  if (!binaryOnPath('caddy')) {
    problems.push({
      remedy: 'brew install caddy',
      trouble: 'The `caddy` proxy is not installed.',
    });
  }
  if (!binaryOnPath('mkcert')) {
    problems.push({
      remedy: 'brew install mkcert nss',
      trouble: 'The `mkcert` certificate tool is not installed.',
    });
    return problems;
  }

  const authority = certificateAuthorityInstalled();
  if (!authority.installed) {
    problems.push({
      remedy: 'mkcert -install',
      trouble:
        authority.reason === 'not-trusted'
          ? "mkcert's local certificate authority is not in this machine's trust store."
          : 'mkcert has no local certificate authority yet.',
    });
  }

  const missing = missingHostsEntries();
  if (missing.length > 0) {
    problems.push({
      remedy: `printf '%s\\n' '${hostsFileLine()}' | sudo tee -a /etc/hosts`,
      trouble: `/etc/hosts does not point ${missing.join(', ')} at ${loopbackHost}.`,
    });
  }

  return problems;
}
