import { z } from 'zod';

export const appEnvironmentSchema = z.enum([
  'local',
  'test',
  'staging',
  'production',
]);

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

export function serviceUrlSchema(name: string, protocols: readonly string[]) {
  return z
    .url()
    .refine(
      (value) => protocols.includes(new URL(value).protocol),
      `${name} must use ${protocols.join(' or ')}`,
    );
}
