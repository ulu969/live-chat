import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

// Railway's healthcheck: the server is up, can reach the database, and the
// database has been set up (tables + Lobby). Says which part is missing if not.
export const GET: APIRoute = async () => {
  const fail = (msg: string) => new Response(msg, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    await db.execute(sql`select 1`);
  } catch {
    return fail('database unreachable: check DATABASE_URL');
  }
  try {
    const rows = await db.execute(sql`select id from rooms where id = 'lobby'`);
    if (rows.length === 0) return fail('database set up but the Lobby is missing: run npm run db:seed');
  } catch {
    return fail('database reachable but not set up (no tables): run npm run db:setup');
  }
  return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
};
