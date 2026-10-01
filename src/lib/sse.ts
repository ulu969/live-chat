/** Server-Sent Events framing. Multi-line payloads need `data: ` on every line (SSE spec). */
export function sseEvent(event: string, data: string, id?: string | number): string {
  let out = `event: ${event}\n`;
  if (id !== undefined) out += `id: ${id}\n`;
  for (const line of data.split(/\r?\n/)) out += `data: ${line}\n`;
  return out + '\n';
}

export const sseComment = (text: string) => `: ${text}\n\n`;

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
};
