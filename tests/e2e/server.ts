/**
 * Runs the production build (dist/) as a child process so tests can restart it.
 * Short timings make the leave/heartbeat behaviour quick to observe.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export const PORT = Number(process.env.E2E_PORT ?? 4399);
export const GRACE_MS = 2_000;
export const HEARTBEAT_MS = 1_000;

let proc: ChildProcess | null = null;

export async function startServer() {
  proc = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/entry.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PRESENCE_GRACE_MS: String(GRACE_MS),
      SSE_HEARTBEAT_MS: String(HEARTBEAT_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/join`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Test server did not start. Is the database up? (npm run db:up, then npm run db:check)');
}

export async function stopServer() {
  if (!proc) return;
  const p = proc;
  proc = null;
  await new Promise<void>((resolve) => {
    p.once('exit', () => resolve());
    p.kill('SIGTERM');
    setTimeout(() => p.kill('SIGKILL'), 3_000);
  });
}

export async function restartServer() {
  await stopServer();
  await startServer();
}
