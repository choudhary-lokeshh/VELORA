import { execFileSync } from 'node:child_process';

execFileSync(
  'pnpm',
  ['install', '--frozen-lockfile', '--strict-peer-dependencies'],
  { stdio: 'inherit' },
);

console.log('Frozen workspace installation and peer policy verified.');
