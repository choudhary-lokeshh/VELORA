import type { ConnectionOptions } from 'bullmq';

export function bullMqConnectionFromUrl(urlValue: string): ConnectionOptions {
  const url = new URL(urlValue);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('QUEUE_REDIS_URL protocol is invalid');
  }
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0) {
    throw new Error('QUEUE_REDIS_URL database number is invalid');
  }

  return {
    db: database,
    host: url.hostname,
    maxRetriesPerRequest: null,
    password:
      url.password.length > 0 ? decodeURIComponent(url.password) : undefined,
    port: url.port.length > 0 ? Number(url.port) : 6379,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    username:
      url.username.length > 0 ? decodeURIComponent(url.username) : undefined,
  };
}
