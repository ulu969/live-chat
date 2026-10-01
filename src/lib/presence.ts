/**
 * Live presence: who is in each room right now. Memory only — never the database.
 *
 * A person can have several tabs open, so we count connections per person.
 * When their last connection closes we wait a grace period before saying they
 * left; a refresh or a brief network drop reconnects within it and cancels the leave.
 */
export type PresentUser = { id: string; nickname: string; color: string };

type Entry = { user: PresentUser; conns: number; leaveTimer?: ReturnType<typeof setTimeout> };

import { PRESENCE_GRACE_MS } from 'astro:env/server';

export const GRACE_MS = PRESENCE_GRACE_MS;

const g = globalThis as unknown as { __chatPresence?: Map<string, Map<string, Entry>> };
const rooms = (g.__chatPresence ??= new Map());

/** Returns true if this person just arrived (not a reconnect, not another tab). */
export function connect(roomId: string, user: PresentUser): boolean {
  let room = rooms.get(roomId);
  if (!room) rooms.set(roomId, (room = new Map()));
  const entry = room.get(user.id);
  if (entry) {
    if (entry.leaveTimer) clearTimeout(entry.leaveTimer);
    entry.leaveTimer = undefined;
    entry.conns++;
    entry.user = user; // pick up a rename
    return false;
  }
  room.set(user.id, { user, conns: 1 });
  return true;
}

/** Call when a connection closes. `onLeave` runs only if they don't come back within the grace period. */
export function disconnect(roomId: string, userId: string, onLeave: (user: PresentUser) => void) {
  const entry = rooms.get(roomId)?.get(userId);
  if (!entry) return;
  entry.conns = Math.max(0, entry.conns - 1);
  if (entry.conns > 0 || entry.leaveTimer) return;
  entry.leaveTimer = setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room || room.get(userId) !== entry || entry.conns > 0) return;
    room.delete(userId);
    if (room.size === 0) rooms.delete(roomId);
    onLeave(entry.user);
  }, GRACE_MS);
}

/** People in the room, including anyone inside their grace period, sorted by name. */
export function online(roomId: string): PresentUser[] {
  return [...(rooms.get(roomId)?.values() ?? [])]
    .map((e) => e.user)
    .sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' }));
}

export function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, room] of rooms) out[id] = room.size;
  return out;
}

/** Update a person's display details everywhere they're present (used by rename later). */
export function updateUser(user: PresentUser): string[] {
  const touched: string[] = [];
  for (const [id, room] of rooms) {
    const entry = room.get(user.id);
    if (entry) {
      entry.user = user;
      touched.push(id);
    }
  }
  return touched;
}
