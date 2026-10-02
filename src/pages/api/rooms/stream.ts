import type { APIRoute } from 'astro';
import { onGlobal, onUser } from '../../../lib/bus';
import { counts } from '../../../lib/presence';
import { listRoomsSince } from '../../../lib/rooms';
import { renderNotification, renderRoomLink } from '../../../lib/render';
import { sseEvent } from '../../../lib/sse';
import { getNotifications } from '../../../lib/notifications';
import { resumePoint, sseResponse } from '../../../lib/sse-stream';

// Live connection for the /rooms list page (mobile navigation): app-wide events only.
// Viewing the list doesn't count as being in any room.
export const GET: APIRoute = ({ request, locals }) => {
  const since = resumePoint(request);
  return sseResponse(
    request,
    (send) => {
      const offGlobal = onGlobal((e) => {
        if (e.type === 'newroom') send(sseEvent('newroom', renderRoomLink(e.room, { standalone: true })));
        else if (e.type === 'counts') send(sseEvent('counts', JSON.stringify(e.counts)));
        else if (e.type === 'renamed') send(sseEvent('renamed', JSON.stringify(e.user)));
      });
      const offUser = onUser(locals.user.id, async (e) => {
        const [n] = await getNotifications([e.notificationId]);
        if (n) send(sseEvent('mention', JSON.stringify({ unread: e.unread, html: renderNotification(n), roomId: n.roomId })));
      });
      return () => {
        offGlobal();
        offUser();
      };
    },
    async (send) => {
      if (since) for (const r of await listRoomsSince(since)) send(sseEvent('newroom', renderRoomLink(r, { standalone: true })));
      send(sseEvent('counts', JSON.stringify(counts())));
    },
  );
};
