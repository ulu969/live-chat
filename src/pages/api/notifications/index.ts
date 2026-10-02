import type { APIRoute } from 'astro';
import { listNotifications } from '../../../lib/notifications';
import { renderNotificationList } from '../../../lib/render';

// GET /api/notifications — the signed-in person's recent mentions (unread first), as HTML for the bell.
export const GET: APIRoute = async ({ locals }) =>
  new Response(renderNotificationList(await listNotifications(locals.user.id)), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
