import { trace, type Tracer } from '@opentelemetry/api';
import pino, { type DestinationStream } from 'pino';

import { correlationHeader } from './client.js';

const redacted = '[REDACTED]';
const redactedUrl = '[REDACTED_URL]';
const maximumSanitizerDepth = 12;
const sensitiveKeys = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'connectionstring',
  'connectionurl',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'currentpassword',
  'databaseurl',
  'newpassword',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
]);
const sensitiveQueryKeys = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'code',
  'key',
  'password',
  'refresh_token',
  'secret',
  'signature',
  'token',
]);
const embeddedUrlPattern =
  /\b(?:https?|postgres(?:ql)?|redis(?:s)?):\/\/[^\s"'<>]+/giu;
const secretAssignmentPattern =
  /\b(access[_-]?token|api[_-]?key|authorization|client[_-]?secret|password|refresh[_-]?token|secret|token)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerTokenPattern = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/giu;

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('password') ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  );
}

function sanitizeParsedUrl(url: URL): string {
  if (
    url.protocol === 'postgres:' ||
    url.protocol === 'postgresql:' ||
    url.protocol === 'redis:' ||
    url.protocol === 'rediss:'
  ) {
    return redactedUrl;
  }

  url.username = url.username.length > 0 ? redacted : '';
  url.password = url.password.length > 0 ? redacted : '';
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveQueryKeys.has(key.toLowerCase()) || isSensitiveKey(key)) {
      url.searchParams.set(key, redacted);
    }
  }
  if (url.hash.length > 1) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    let fragmentChanged = false;
    for (const key of [...fragment.keys()]) {
      if (sensitiveQueryKeys.has(key.toLowerCase()) || isSensitiveKey(key)) {
        fragment.set(key, redacted);
        fragmentChanged = true;
      }
    }
    if (fragmentChanged) url.hash = fragment.toString();
  }
  return url.toString();
}

export function sanitizeUrlForLogging(value: string | URL): string {
  try {
    return sanitizeParsedUrl(
      value instanceof URL ? new URL(value.toString()) : new URL(value),
    );
  } catch {
    return redactEmbeddedUrls(String(value));
  }
}

export function redactEmbeddedUrls(value: string): string {
  const urlsRedacted = value.replace(embeddedUrlPattern, (match) =>
    sanitizeUrlForLogging(match),
  );
  return urlsRedacted
    .replace(bearerTokenPattern, `$1 ${redacted}`)
    .replace(
      secretAssignmentPattern,
      (_match, key: string, separator: string) =>
        `${key}${separator}${redacted}`,
    );
}

function sanitizeObject(
  value: object,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value instanceof URL) return sanitizeUrlForLogging(value);
  if (value instanceof Error) {
    return {
      message: redactEmbeddedUrls(value.message),
      name: redactEmbeddedUrls(value.name),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name}]`;
  if (seen.has(value)) return '[CIRCULAR]';
  if (depth >= maximumSanitizerDepth) return '[MAX_DEPTH]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = redacted;
    } else if (normalizedKey(key).endsWith('url') && typeof item === 'string') {
      output[key] = sanitizeUrlForLogging(item);
    } else {
      output[key] = sanitizeLogValue(item, depth + 1, seen);
    }
  }
  return output;
}

export function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return redactEmbeddedUrls(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return sanitizeObject(value, depth, seen);
  return `[${typeof value}]`;
}

export interface SafeLogger {
  debug(fields: Readonly<Record<string, unknown>>, message: string): void;
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
  fatal(fields: Readonly<Record<string, unknown>>, message: string): void;
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  trace(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface LoggerOptions {
  readonly level: string;
  readonly serviceName: string;
}

export function createLogger(
  options: LoggerOptions,
  destination?: DestinationStream,
): SafeLogger {
  const logger = pino(
    {
      base: { service: options.serviceName },
      level: options.level,
    },
    destination,
  );
  const write = (
    level: 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn',
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => {
    logger[level](sanitizeLogValue(fields), redactEmbeddedUrls(message));
  };

  return {
    debug: (fields, message) => {
      write('debug', fields, message);
    },
    error: (fields, message) => {
      write('error', fields, message);
    },
    fatal: (fields, message) => {
      write('fatal', fields, message);
    },
    info: (fields, message) => {
      write('info', fields, message);
    },
    trace: (fields, message) => {
      write('trace', fields, message);
    },
    warn: (fields, message) => {
      write('warn', fields, message);
    },
  };
}

export function getTracer(serviceName: string): Tracer {
  return trace.getTracer(serviceName);
}

export { correlationHeader };
