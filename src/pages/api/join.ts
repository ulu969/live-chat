import type { APIRoute } from 'astro';
import { COOKIE, COOKIE_MAX_AGE, createUser, findByNickname, validateNickname } from '../../lib/users';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const raw = String(form.get('nickname') ?? '');
  const back = (error: string) =>
    redirect(`/join?error=${encodeURIComponent(error)}&nickname=${encodeURIComponent(raw)}`, 303);

  const v = validateNickname(raw);
  if (!v.ok) return back(v.error);
  if (await findByNickname(v.value)) return back(`“${v.value}” is already taken. Try another nickname.`);

  let user;
  try {
    user = await createUser(v.value);
  } catch {
    // Unique index race: someone grabbed it between the check and the insert.
    return back(`“${v.value}” is already taken. Try another nickname.`);
  }

  cookies.set(COOKIE, user.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: COOKIE_MAX_AGE,
  });
  return redirect('/rooms/lobby', 303);
};
