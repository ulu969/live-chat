/**
 * Builds a long-lived SSE Response.
 *  - `subscribe` wires up bus listeners using `send` and returns an unsubscribe function.
 *  - `replay` (optional) sends what the browser missed while disconnected. Live events
 *    that arrive during the replay are held back and sent afterwards, so order is kept.
 * Also sends a heartbeat and cleans up when the browser disconnects.
 */
import { SSE_HEARTBEAT_MS as HEARTBEAT_MS } from 'astro:env/server';
import { SSE_HEADERS, sseComment } from './sse';

/**
 * Where the browser left off: `?since=<ms>` (sent by our client on every (re)connect)
 * or the standard `Last-Event-ID` header (sent by the browser's own auto-reconnect).
 */
export function resumePoint(request: Request): Date | null {
  const fromQuery = Number(new URL(request.url).searchParams.get('since'));
  const fromHeader = Number(request.headers.get('last-event-id'));
  const ms = Math.max(Number.isFinite(fromQuery) ? fromQuery : 0, Number.isFinite(fromHeader) ? fromHeader : 0);
  return ms > 0 ? new Date(ms) : null;
}

export function sseResponse(
  request: Request,
  subscribe: (send: (chunk: string) => void) => () => void,
  replay?: (send: (chunk: string) => void) => Promise<void>,
): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Hold live events until the replay has been written.
      let held: string[] | null = replay ? [] : null;
      const send = (chunk: string) => (held ? held.push(chunk) : write(chunk));

      write('retry: 2000\n\n'); // browser reconnect delay
      write(sseComment('connected'));
      const unsubscribe = subscribe(send);
      // Comments keep proxies (e.g. Railway's) from closing an idle connection.
      const heartbeat = setInterval(() => write(sseComment('ping')), HEARTBEAT_MS);

      if (replay) {
        replay(write)
          .catch((err) => console.error('[sse] replay failed', err))
          .finally(() => {
            const queued = held ?? [];
            held = null;
            queued.forEach(write);
          });
      }

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      // Client went away: Astro's Node adapter fires one or both of these.
      request.signal.addEventListener('abort', () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
