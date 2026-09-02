import {
  refuseForeignSurfaces,
  startAuthEnvironment,
} from './auth-environment.js';

export default async function globalSetup(): Promise<void> {
  // Before anything is started, because the point is to catch a server this
  // run did not start and would otherwise silently adopt.
  await refuseForeignSurfaces();
  await startAuthEnvironment();
}
