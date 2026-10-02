/**
 * Live presence: who is in each room right now. Memory only — never the database.
 *
 * Two separate ideas live here:
 *
 *  1. ONLINE — someone has a live connection open (or had one within the last
 *     GRACE_MS). This drives the online count and the "who's here" list. A person
 *     with several tabs counts once.
 *
 *  2. LEFT — the moment we announce "X left" in the chat. A dropped connection alone
 *     is not leaving: a laptop going to sleep, Wi-Fi blips and background-tab
 *     throttling all drop connections. So "left" is announced only when:
 *       - the page told us it was closing (a leave beacon on pagehide), and the person
 *         didn't come back within GRACE_MS (a refresh comes back within it), or
 *       - they've been gone for AWAY_MS with no beacon (fallback, e.g. a phone that
 *         killed the tab without sending one), or
 *       - they clicked Exit (announced immediately; see leaveEverywhere).
 */
import { PRESENCE_GRACE_MS, PRESENCE_AWAY_MS } from 'astro:env/server';

export type PresentUser = { id: string; nickname: string; color: string };

export const GRACE_MS = PRESENCE_GRACE_MS;
export const AWAY_MS = PRESENCE_AWAY_MS;
/** A leave beacon counts for the disconnect it arrives next to (before or after). */
const BEACON_WINDOW_MS = 15_000;

type Timer = ReturnType<typeof setTimeout>;
type Entry = {
  user: PresentUser;
  conns: number;
  /** Set while their last connection is closed and we're waiting to see if they come back. */
  graceTimer?: Timer;
  lastDisconnectAt?: number;
  leaveBeaconAt?: number;
};
type Away = { user: PresentUser; timer: Timer };

const g = globalThis as unknown as {
  __chatPresence?: Map<string, Map<string, Entry>>;
  __chatAway?: Map<string, Map<string, Away>>;
};
const rooms: Map<string, Map<string, Entry>> = (g.__chatPresence ??= new Map());
/** Offline but not yet announced as "left" (waiting out AWAY_MS). */
const away: Map<string, Map<string, Away>> = (g.__chatAway ??= new Map());

const roomMap = <T>(m: Map<string, Map<string, T>>, roomId: string) => {
  let r = m.get(roomId);
  if (!r) m.set(roomId, (r = new Map()));
  return r;
};
const drop = <T>(m: Map<string, Map<string, T>>, roomId: string, userId: string) => {
  const r = m.get(roomId);
  r?.delete(userId);
  if (r && r.size === 0) m.delete(roomId);
};

function cancelAway(roomId: string, userId: string) {
  const a = away.get(roomId)?.get(userId);
  if (a) {
    clearTimeout(a.timer);
    drop(away, roomId, userId);
  }
}

/** A connection opened. Silently cancels any pending grace period or away timer. */
export function connect(roomId: string, user: PresentUser) {
  cancelAway(roomId, user.id);
  const room = roomMap(rooms, roomId);
  const entry = room.get(user.id);
  if (entry) {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    entry.graceTimer = undefined;
    entry.leaveBeaconAt = undefined;
    entry.conns++;
    entry.user = user; // pick up a rename
  } else {
    room.set(user.id, { user, conns: 1 });
  }
}

/** The page is closing (pagehide beacon). May arrive just before or just after the disconnect. */
export function markLeaving(roomId: string, userId: string) {
  const entry = rooms.get(roomId)?.get(userId);
  if (entry) entry.leaveBeaconAt = Date.now();
}

const beaconMatches = (e: Entry) =>
  e.leaveBeaconAt !== undefined &&
  e.lastDisconnectAt !== undefined &&
  Math.abs(e.leaveBeaconAt - e.lastDisconnectAt) <= BEACON_WINDOW_MS;

/**
 * A connection closed. After GRACE_MS with no connection they go offline (`onOffline`),
 * and `onLeft` runs then if the page said it was closing, otherwise after AWAY_MS.
 */
export function disconnect(
  roomId: string,
  userId: string,
  handlers: { onOffline: () => void; onLeft: (user: PresentUser) => void },
) {
  const entry = rooms.get(roomId)?.get(userId);
  if (!entry) return;
  entry.conns = Math.max(0, entry.conns - 1);
  if (entry.conns > 0 || entry.graceTimer) return;
  entry.lastDisconnectAt = Date.now();

  entry.graceTimer = setTimeout(() => {
    if (rooms.get(roomId)?.get(userId) !== entry || entry.conns > 0) return;
    drop(rooms, roomId, userId);
    handlers.onOffline();

    if (beaconMatches(entry)) {
      handlers.onLeft(entry.user);
      return;
    }
    // No beacon: probably asleep or a network drop. Announce only if they stay gone.
    const timer = setTimeout(() => {
      drop(away, roomId, userId);
      handlers.onLeft(entry.user);
    }, Math.max(0, AWAY_MS - GRACE_MS));
    roomMap(away, roomId).set(userId, { user: entry.user, timer });
  }, GRACE_MS);
}

/** Exit button: remove them from every room now. Returns the rooms they were in (online or away). */
export function leaveEverywhere(userId: string): { roomId: string; user: PresentUser }[] {
  const out: { roomId: string; user: PresentUser }[] = [];
  for (const [roomId, room] of [...rooms]) {
    const e = room.get(userId);
    if (!e) continue;
    if (e.graceTimer) clearTimeout(e.graceTimer);
    drop(rooms, roomId, userId);
    out.push({ roomId, user: e.user });
  }
  for (const [roomId, room] of [...away]) {
    const a = room.get(userId);
    if (!a) continue;
    cancelAway(roomId, userId);
    if (!out.some((o) => o.roomId === roomId)) out.push({ roomId, user: a.user });
  }
  return out;
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

// ---- Page loads ------------------------------------------------------------------
// Each room page render gets a random page id in its stream URL. The first connection
// with a new id is a real page load; later ones with the same id are reconnects (wake
// from sleep, network blip) and never announce "joined".
const PAGE_TTL_MS = 24 * 60 * 60 * 1000;
const gp = globalThis as unknown as { __chatPages?: Map<string, number> };
const pages: Map<string, number> = (gp.__chatPages ??= new Map());

/** True the first time a page id is seen. */
export function isFreshPage(pageId: string | null): boolean {
  if (!pageId) return false; // pages rendered before this change: treat as reconnects
  const now = Date.now();
  const fresh = !pages.has(pageId);
  pages.set(pageId, now);
  if (pages.size > 5_000) for (const [id, t] of pages) if (now - t > PAGE_TTL_MS) pages.delete(id);
  return fresh;
}
