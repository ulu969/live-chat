import type { APIRoute } from 'astro';
import { getRoom } from '../../../../lib/rooms';
import { listMessages } from '../../../../lib/messages';
import { renderHistoryPage } from '../../../../lib/render';

// GET /api/rooms/:id/history?before=<ms timestamp>&id=<message id>
// Returns the previous page as HTML: older messages + a new "Load earlier" row (or the room start).
export const GET: APIRoute = async ({ params, url, locals }) => {
  const room = await getRoom(params.id!);
  if (!room) return new Response('Room not found', { status: 404 });

  const beforeMs = Number(url.searchParams.get('before'));
  if (!Number.isFinite(beforeMs) || beforeMs <= 0) return new Response('`before` must be a timestamp', { status: 400 });

  const page = await listMessages(room.id, {
    before: new Date(beforeMs),
    beforeId: url.searchParams.get('id') ?? undefined,
  });
  return new Response(renderHistoryPage(room, page, locals.user.id), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
