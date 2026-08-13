import { spawn } from 'node:child_process';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

const [postgres, redis] = await Promise.all([
  new PostgreSqlContainer('postgres:18.4-alpine3.24').start(),
  new GenericContainer('redis:8.10.0-alpine3.23')
    .withCommand([
      'redis-server',
      '--appendonly',
      'yes',
      '--appendfsync',
      'always',
      '--save',
      '60',
      '1',
    ])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections tcp'))
    .start(),
]);

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      'bun',
      ['test', '--timeout', '180000', 'test/integration'],
      {
        env: {
          ...process.env,
          TEST_DATABASE_URL: postgres.getConnectionUri(),
          TEST_REDIS_CONTAINER_ID: redis.getId(),
          TEST_REDIS_HOST: redis.getHost(),
          TEST_REDIS_PORT: String(redis.getMappedPort(6379)),
          TEST_REDIS_URL: `redis://${redis.getHost()}:${String(
            redis.getMappedPort(6379),
          )}`,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Bun integration tests ended with ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await Promise.allSettled([postgres.stop(), redis.stop()]);
}
