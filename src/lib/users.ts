import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/client';
import type { User } from '../db/schema';

export const COOKIE = 'chat_user_id';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Avatar colors chosen to read on both light and dark surfaces with white initials.
const COLORS = [
  '#1a7f78', '#2f6fb0', '#7a4fb5', '#b2457a', '#c0562f', '#8a6d12',
  '#3d8a3f', '#4a5bc4', '#a03c3c', '#2b7f99', '#916332', '#5d6f2a',
];
export const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export function validateNickname(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2) return { ok: false, error: 'Nicknames need at least 2 characters.' };
  if (value.length > 24) return { ok: false, error: 'Nicknames can be at most 24 characters.' };
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(value))
    return { ok: false, error: 'Use letters, numbers, spaces, dots, dashes or underscores.' };
  if (value.toLowerCase() === 'system' || value.toLowerCase() === 'everyone')
    return { ok: false, error: `“${value}” is reserved. Pick another nickname.` };
  return { ok: true, value };
}

export async function getUser(id: string | undefined): Promise<User | null> {
  if (!id) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return user ?? null;
}

export async function findByNickname(nickname: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.nickname}) = lower(${nickname})`)
    .limit(1);
  return user ?? null;
}

export async function createUser(nickname: string): Promise<User> {
  const [user] = await db
    .insert(schema.users)
    .values({ id: nanoid(), nickname, color: randomColor() })
    .returning();
  return user;
}
