import type { APIRoute } from 'astro';
import { COOKIE } from '../../lib/users';

export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(COOKIE, { path: '/' });
  return redirect('/join', 303);
};
