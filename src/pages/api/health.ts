import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

// Railway's healthcheck: the server is up and can reach the database.
export const GET: APIRoute = async () => {
  try {
    await db.execute(sql`select 1`);
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('database unreachable', { status: 503 });
  }
};
