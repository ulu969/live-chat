/**
 * Live typing state per room. Each POST /typing (re)starts a 2-second timer;
 * when it runs out the person is no longer "typing". Memory only.
 */
export type Typist = { id: string; nickname: string };

const EXPIRY_MS = 2_000;

type Entry = { user: Typist; timer: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { __chatTyping?: Map<string, Map<string, Entry>> };
const rooms = (g.__chatTyping ??= new Map());

export function typists(roomId: string): Typist[] {
  return [...(rooms.get(roomId)?.values() ?? [])].map((e) => e.user);
}

/** Marks someone as typing. `onChange` fires when the set of typists changes (start or expiry). */
export function setTyping(roomId: string, user: Typist, onChange: () => void) {
  let room = rooms.get(roomId);
  if (!room) rooms.set(roomId, (room = new Map()));
  const existing = room.get(user.id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => clearTyping(roomId, user.id, onChange), EXPIRY_MS);
  room.set(user.id, { user, timer });
  if (!existing) onChange();
}

/** Stops someone typing (expiry, or they sent their message). */
export function clearTyping(roomId: string, userId: string, onChange: () => void) {
  const room = rooms.get(roomId);
  const entry = room?.get(userId);
  if (!room || !entry) return;
  clearTimeout(entry.timer);
  room.delete(userId);
  if (room.size === 0) rooms.delete(roomId);
  onChange();
}
