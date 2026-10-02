import type { APIRoute } from 'astro';
import { markLeaving } from '../../../../lib/presence';

// POST /api/rooms/:id/leave — sent with navigator.sendBeacon when the room page is
// closing (tab closed, navigating away, refresh). It only marks intent: if the person
// is back within the grace period (a refresh), nothing is announced.
export const POST: APIRoute = ({ params, locals }) => {
  markLeaving(params.id!, locals.user.id);
  return new Response(null, { status: 204 });
};
