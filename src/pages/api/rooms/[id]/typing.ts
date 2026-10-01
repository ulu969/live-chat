import type { APIRoute } from 'astro';
import { setTyping } from '../../../../lib/typing';
import { typingChanged } from '../../../../lib/live';
import { getRoom } from '../../../../lib/rooms';

// POST /api/rooms/:id/typing — "I'm typing". Expires 2 s after the last call.
export const POST: APIRoute = async ({ params, locals }) => {
  const room = await getRoom(params.id!);
  if (!room) return new Response('Room not found', { status: 404 });
  const { id, nickname } = locals.user;
  setTyping(room.id, { id, nickname }, () => typingChanged(room.id));
  return new Response(null, { status: 204 });
};
