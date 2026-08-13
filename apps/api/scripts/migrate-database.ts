import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMigrationConfig } from '@velora/config/server';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

const config = loadMigrationConfig(process.env);
const client = new Bun.SQL(config.DATABASE_URL, {
  connectionTimeout: 5,
  max: 1,
});
const applicationRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  await migrate(drizzle(client), {
    migrationsFolder: resolve(applicationRoot, 'drizzle'),
  });
} finally {
  await client.close();
}
