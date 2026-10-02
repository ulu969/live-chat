/**
 * Glue between live state (presence, typing) and the bus. Join/leave also write
 * system messages to the database so they show up in history.
 */
import { emitGlobal, emitToRoom } from './bus';
import type { User } from '../db/schema';
import * as presence from './presence';
import { createMessage, lastMembershipEvent } from './messages';

export function announcePresence(roomId: string) {
  emitToRoom(roomId, { type: 'presence' });
  emitGlobal({ type: 'counts', counts: presence.counts() });
}

async function postSystem(
  roomId: string,
  user: presence.PresentUser,
  type: 'join' | 'leave' | 'rename',
  content: string,
) {
  const message = await createMessage({ roomId, user, content, type });
  emitToRoom(roomId, { type: 'message', message });
}

/** Post "left" unless their latest join/leave in this room already is a "left". */
async function postLeft(roomId: string, user: presence.PresentUser) {
  if ((await lastMembershipEvent(roomId, user.id)) === 'join') {
    await postSystem(roomId, user, 'leave', `${user.nickname} left`);
  }
}

/**
 * A live connection opened. "joined" is announced only on a real page load (not a
 * reconnect after sleep or a network drop), and only if they haven't already joined.
 */
export async function connectionOpened(roomId: string, user: presence.PresentUser, freshPage: boolean) {
  presence.connect(roomId, user);
  if (freshPage && (await lastMembershipEvent(roomId, user.id)) !== 'join') {
    await postSystem(roomId, user, 'join', `${user.nickname} joined`);
  }
  announcePresence(roomId);
}

/** A live connection closed. See presence.ts for when that becomes "left". */
export function connectionClosed(roomId: string, userId: string) {
  presence.disconnect(roomId, userId, {
    onOffline: () => announcePresence(roomId),
    onLeft: (user) => postLeft(roomId, user).catch((err) => console.error('[presence] could not post leave', err)),
  });
}

/** Exit button: announce "left" now in every room they were in. */
export async function leaveEverywhere(userId: string) {
  for (const { roomId, user } of presence.leaveEverywhere(userId)) {
    await postLeft(roomId, user).catch((err) => console.error('[presence] could not post leave', err));
    announcePresence(roomId);
  }
}

/**
 * After a rename: post "Old changed their name to New" in the rooms they're in (or the room
 * they're looking at, if they're in none), refresh presence, and tell every open page so
 * names already on screen update.
 */
export async function announceRename(user: User, oldName: string, currentRoom: string | null) {
  const present = { id: user.id, nickname: user.nickname, color: user.color };
  presence.updateUser(present);
  const roomIds = presence.roomsOf(user.id);
  if (!roomIds.length && currentRoom) roomIds.push(currentRoom);
  for (const roomId of roomIds) {
    await postSystem(roomId, present, 'rename', `${oldName} changed their name to ${user.nickname}`);
    announcePresence(roomId);
  }
  emitGlobal({ type: 'renamed', user: { id: user.id, nickname: user.nickname } });
}

export const typingChanged = (roomId: string) => emitToRoom(roomId, { type: 'typing' });
