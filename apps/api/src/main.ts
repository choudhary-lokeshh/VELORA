import { createApplication, type ApplicationRuntime } from './application.js';
import { redactEmbeddedUrls } from '@velora/observability/server';

export function startApi(): ApplicationRuntime {
  const runtime = createApplication();
  runtime.app.listen({
    hostname: runtime.config.HOST,
    port: runtime.config.PORT,
  });
  runtime.dependencies.logger.info(
    { host: runtime.config.HOST, port: runtime.config.PORT },
    'API started',
  );
  return runtime;
}

async function runMain(): Promise<void> {
  const runtime = startApi();
  let shutdown: Promise<void> | undefined;
  const stop = (signal: string) => {
    shutdown ??= (async () => {
      runtime.dependencies.logger.info({ signal }, 'API shutdown requested');
      await runtime.app.stop();
      await runtime.close();
    })();
    return shutdown;
  };

  await new Promise<void>((resolve, reject) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void stop(signal).then(resolve, reject);
      });
    }
  });
}

if (import.meta.main) {
  void runMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(
      `VELORA API startup or shutdown failed: ${redactEmbeddedUrls(message)}\n`,
    );
    process.exitCode = 1;
  });
}
