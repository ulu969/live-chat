import type { APIRoute } from 'astro';
import { COOKIE, getUser } from '../../lib/users';
import { leaveEverywhere } from '../../lib/live';

// Exit: announce "left" in every room right away, then forget this browser.
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const user = await getUser(cookies.get(COOKIE)?.value).catch(() => null);
  if (user) await leaveEverywhere(user.id);
  cookies.delete(COOKIE, { path: '/' });
  return redirect('/join', 303);
};
