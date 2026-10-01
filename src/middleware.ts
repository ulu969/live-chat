import { defineMiddleware } from 'astro:middleware';
import { COOKIE, getUser } from './lib/users';

const PUBLIC = new Set(['/join', '/api/join', '/api/leave', '/api/health']);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;
  if (PUBLIC.has(pathname) || pathname.startsWith('/_astro/') || pathname === '/favicon.svg') {
    return next();
  }

  // The acting user always comes from the cookie, never from the request body.
  const user = await getUser(ctx.cookies.get(COOKIE)?.value);
  if (!user || user.id === 'system') {
    ctx.cookies.delete(COOKIE, { path: '/' });
    if (pathname.startsWith('/api/')) return new Response('Not signed in', { status: 401 });
    return ctx.redirect('/join');
  }

  ctx.locals.user = user;
  return next();
});
