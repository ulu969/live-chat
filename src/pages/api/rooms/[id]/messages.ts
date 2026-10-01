import type { APIRoute } from 'astro';
import { getRoom } from '../../../../lib/rooms';
import { createMessage, MAX_MESSAGE_LENGTH } from '../../../../lib/messages';
import { emitToRoom } from '../../../../lib/bus';
import { clearTyping } from '../../../../lib/typing';
import { typingChanged } from '../../../../lib/live';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const room = await getRoom(params.id!);
  if (!room) return new Response('Room not found', { status: 404 });

  const form = await request.formData();
  const content = String(form.get('content') ?? '').trim();
  if (!content) return new Response('Message is empty', { status: 422 });
  if (content.length > MAX_MESSAGE_LENGTH)
    return new Response(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters`, { status: 422 });

  // Author always comes from the cookie (middleware), never from the form.
  const { id, nickname, color } = locals.user;
  const message = await createMessage({ roomId: room.id, user: { id, nickname, color }, content });

  // Saved first, then broadcast. The sender's own window receives it over SSE like everyone else.
  emitToRoom(room.id, { type: 'message', message });
  // Sending ends "is typing…" right away instead of waiting for the 2 s expiry.
  clearTyping(room.id, id, () => typingChanged(room.id));
  return new Response(null, { status: 204 });
};
