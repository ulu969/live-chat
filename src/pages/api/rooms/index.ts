import type { APIRoute } from 'astro';
import { createRoom, validateRoom } from '../../../lib/rooms';
import { emitGlobal } from '../../../lib/bus';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const isHtmx = request.headers.get('HX-Request') === 'true';
  const fail = (msg: string) =>
    isHtmx
      ? new Response(msg, { status: 422 })
      : redirect(`/rooms?error=${encodeURIComponent(msg)}`, 303);

  const v = validateRoom(form.get('name'), form.get('description'));
  if (!v.ok) return fail(v.error);

  const room = await createRoom(v.name, v.description, locals.user.id);
  if (!room) return fail(`A room called “${v.name}” already exists.`);

  // Everyone's sidebar picks it up live.
  emitGlobal({ type: 'newroom', room });

  const to = `/rooms/${room.id}`;
  return isHtmx ? new Response(null, { status: 204, headers: { 'HX-Redirect': to } }) : redirect(to, 303);
};
