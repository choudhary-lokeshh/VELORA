import { createApplication, type ApplicationRuntime } from './application.js';
import { redactEmbeddedUrls } from '@velora/observability/server';

export async function startApi(): Promise<ApplicationRuntime> {
  const runtime = createApplication();
  // Before the port opens, not after. A pool that establishes its connections
  // under the first burst of traffic is the state the driver loses one in, and
  // a database that cannot be reached should fail a startup rather than serve
  // readiness failures.
  await runtime.warm();
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
  // Started, then handled, both before the first await. Startup now does real
  // work — it opens every pooled connection before the port binds — and a
  // supervisor that sends SIGTERM during it must get the ordered shutdown
  // rather than the default handler's kill. `startApi` runs synchronously up to
  // its first await, so the handlers below are installed in the same turn.
  const started = startApi();
  let shutdown: Promise<void> | undefined;
  const stop = (signal: string) => {
    shutdown ??= (async () => {
      // A signal that arrives mid-startup waits for it: closing half-built
      // state would leave the listener or the pool behind. A startup that
      // failed has nothing to close and reports itself below.
      const runtime = await started.catch(() => undefined);
      if (runtime === undefined) return;
      runtime.dependencies.logger.info({ signal }, 'API shutdown requested');
      await runtime.app.stop();
      await runtime.close();
    })();
    return shutdown;
  };

  const signalled = new Promise<void>((resolve, reject) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void stop(signal).then(resolve, reject);
      });
    }
  });

  await started;
  await signalled;
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
