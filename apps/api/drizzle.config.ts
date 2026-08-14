import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  migrations: {
    prefix: 'index',
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
  out: './drizzle',
  schema: [
    './src/auth/schema.ts',
    './src/creators/schema.ts',
    './src/discovery/schema.ts',
    './src/messaging/schema.ts',
    './src/notifications/schema.ts',
    './src/safety/schema.ts',
    './src/users/schema.ts',
  ],
  strict: true,
  verbose: true,
});
