import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  migrations: {
    prefix: 'index',
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
  out: './drizzle',
  schema: ['./src/auth/schema.ts'],
  strict: true,
  verbose: true,
});
