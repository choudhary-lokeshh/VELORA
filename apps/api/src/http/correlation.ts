const acceptedCorrelationId = /^[A-Za-z0-9._:-]{1,128}$/u;

export function normalizeCorrelationId(value: unknown): string {
  return typeof value === 'string' && acceptedCorrelationId.test(value)
    ? value
    : crypto.randomUUID();
}
