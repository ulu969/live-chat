/**
 * Runs once before the suite, however Playwright is started (npm run test:e2e,
 * npx playwright test, --ui, --headed): builds the app so the tests always run
 * against the current code. Set E2E_SKIP_BUILD=1 to reuse an existing dist/.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export default function globalSetup() {
  // Fail fast with a clear message if the database isn't reachable or set up.
  try {
    execSync('node --env-file-if-exists=.env scripts/db-check.mjs', { stdio: 'pipe' });
  } catch (err) {
    const out = (err as { stdout?: Buffer; stderr?: Buffer });
    throw new Error(
      `The database isn't ready, so the tests can't run.\n${out.stdout ?? ''}${out.stderr ?? ''}` +
        'Start it with `npm run db:up && npm run db:setup`.',
    );
  }

  if (process.env.E2E_SKIP_BUILD && existsSync('dist/server/entry.mjs')) return;
  console.log('Building the app for end-to-end tests…');
  execSync('npx astro build', { stdio: 'inherit' });
}
