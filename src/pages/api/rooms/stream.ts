import type { APIRoute } from 'astro';
import { onGlobal } from '../../../lib/bus';
import { counts } from '../../../lib/presence';
import { listRoomsSince } from '../../../lib/rooms';
import { renderRoomLink } from '../../../lib/render';
import { sseEvent } from '../../../lib/sse';
import { resumePoint, sseResponse } from '../../../lib/sse-stream';

// Live connection for the /rooms list page (mobile navigation): app-wide events only.
// Viewing the list doesn't count as being in any room.
export const GET: APIRoute = ({ request }) => {
  const since = resumePoint(request);
  return sseResponse(
    request,
    (send) =>
      onGlobal((e) => {
        if (e.type === 'newroom') send(sseEvent('newroom', renderRoomLink(e.room, { standalone: true })));
        else if (e.type === 'counts') send(sseEvent('counts', JSON.stringify(e.counts)));
      }),
    async (send) => {
      if (since) for (const r of await listRoomsSince(since)) send(sseEvent('newroom', renderRoomLink(r, { standalone: true })));
      send(sseEvent('counts', JSON.stringify(counts())));
    },
  );
};
