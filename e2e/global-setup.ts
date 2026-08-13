import { startAuthEnvironment } from './auth-environment.js';

export default async function globalSetup(): Promise<void> {
  await startAuthEnvironment();
}
