import type { APIRoute } from 'astro';
import { renameUser, validateNickname } from '../../lib/users';
import { getRoom } from '../../lib/rooms';
import { announceRename } from '../../lib/live';

// POST /api/rename — change the signed-in person's nickname (from the cookie, never the form).
export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData();
  const v = validateNickname(form.get('nickname'));
  if (!v.ok) return new Response(v.error, { status: 422 });

  const me = locals.user;
  if (v.value === me.nickname) return new Response(null, { status: 204 }); // nothing changed

  const user = await renameUser(me.id, v.value);
  if (!user) return new Response(`“${v.value}” is already taken. Try another nickname.`, { status: 422 });

  const roomId = String(form.get('room') ?? '');
  const currentRoom = roomId && (await getRoom(roomId)) ? roomId : null;
  await announceRename(user, me.nickname, currentRoom);
  return new Response(null, { status: 204 });
};
