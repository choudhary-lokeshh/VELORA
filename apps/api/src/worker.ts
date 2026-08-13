import { loadServerConfig } from '@velora/config/server';
import { createLogger, redactEmbeddedUrls } from '@velora/observability/server';

import { bootstrapJobRegistry } from './jobs/registry.js';
import { createWorkerRuntime } from './jobs/runtime.js';

export async function runWorkerMain(): Promise<void> {
  const config = loadServerConfig(process.env);
  const logger = createLogger({
    level: config.LOG_LEVEL,
    serviceName: 'velora-worker',
  });
  const runtime = await createWorkerRuntime(
    config,
    bootstrapJobRegistry,
    logger,
  );
  logger.info(
    { registrations: bootstrapJobRegistry.list().length },
    'worker started',
  );
  const keepAlive = setInterval(() => undefined, 60_000);

  let shutdown: Promise<void> | undefined;
  const stop = (signal: string) => {
    shutdown ??= (async () => {
      logger.info({ signal }, 'worker shutdown requested');
      await runtime.close();
    })();
    return shutdown;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
          void stop(signal).then(resolve, reject);
        });
      }
      void runtime.completion.then(resolve, reject);
    });
  } finally {
    clearInterval(keepAlive);
  }
}

if (import.meta.main) {
  void runWorkerMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(
      `VELORA worker startup or shutdown failed: ${redactEmbeddedUrls(message)}\n`,
    );
    process.exitCode = 1;
  });
}
