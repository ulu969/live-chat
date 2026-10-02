import type { MiddlewareHandler } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { COOKIE, getUser } from './lib/users';
import { ensureNames } from './lib/mentions';

const PUBLIC = new Set(['/join', '/api/join', '/api/leave', '/api/health']);

// Wraps every request so the real database error gets logged. Drizzle wraps it in a
// "Failed query" error, and Astro's log shows only that wrapper, not the reason.
export const onRequest = defineMiddleware(async (ctx, next) => {
  try {
    return (await handle(ctx, next)) as Response;
  } catch (err) {
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    if (cause?.message) {
      console.error(`[db] ${ctx.url.pathname}: ${cause.message}${cause.code ? ` (code ${cause.code})` : ''}`);
    }
    throw err;
  }
});

const handle: MiddlewareHandler = async (ctx, next) => {
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
  await ensureNames(); // nickname list for @mentions (loaded once)
  return next();
};
