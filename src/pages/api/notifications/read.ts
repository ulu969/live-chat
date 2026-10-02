import type { APIRoute } from 'astro';
import { markAllRead } from '../../../lib/notifications';

// POST /api/notifications/read — mark all of the signed-in person's notifications read.
export const POST: APIRoute = async ({ locals }) => {
  await markAllRead(locals.user.id);
  return new Response(null, { status: 204 });
};
