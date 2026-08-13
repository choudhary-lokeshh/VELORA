import { stopAuthEnvironment } from './auth-environment.js';

export default async function globalTeardown(): Promise<void> {
  await stopAuthEnvironment();
}
