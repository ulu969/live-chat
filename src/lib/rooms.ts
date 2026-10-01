import { asc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/client';
import type { Room } from '../db/schema';

export async function listRooms(): Promise<Room[]> {
  // Lobby first, then everything else in creation order.
  const all = await db.select().from(schema.rooms).orderBy(asc(schema.rooms.createdAt));
  return [...all.filter((r) => r.id === 'lobby'), ...all.filter((r) => r.id !== 'lobby')];
}

export async function getRoom(id: string): Promise<Room | null> {
  const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, id)).limit(1);
  return room ?? null;
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  );
}

export function validateRoom(rawName: unknown, rawDesc: unknown) {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  const description = String(rawDesc ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false as const, error: 'Room names need at least 2 characters.' };
  if (name.length > 40) return { ok: false as const, error: 'Room names can be at most 40 characters.' };
  if (description.length > 140) return { ok: false as const, error: 'Descriptions can be at most 140 characters.' };
  return { ok: true as const, name, description: description || null };
}

/** Creates a room with a URL slug id. Returns null if a room with that name already exists. */
export async function createRoom(name: string, description: string | null, createdBy: string): Promise<Room | null> {
  const [dupe] = await db
    .select({ id: schema.rooms.id })
    .from(schema.rooms)
    .where(sql`lower(${schema.rooms.name}) = lower(${name})`)
    .limit(1);
  if (dupe) return null;

  const base = slugify(name);
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const [room] = await db
      .insert(schema.rooms)
      .values({ id, name, description, createdBy })
      .onConflictDoNothing({ target: schema.rooms.id })
      .returning();
    if (room) return room;
  }
  throw new Error('Could not find a free id for this room');
}

/** Rooms created at or after `since` — for sidebars catching up after a reconnect. */
export async function listRoomsSince(since: Date): Promise<Room[]> {
  return db.select().from(schema.rooms).where(gte(schema.rooms.createdAt, since)).orderBy(asc(schema.rooms.createdAt));
}
