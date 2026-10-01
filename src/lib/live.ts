/**
 * Glue between live state (presence, typing) and the bus. Join/leave also write
 * system messages to the database so they show up in history.
 */
import { emitGlobal, emitToRoom } from './bus';
import * as presence from './presence';
import { createMessage, lastMembershipEvent } from './messages';

export function announcePresence(roomId: string) {
  emitToRoom(roomId, { type: 'presence' });
  emitGlobal({ type: 'counts', counts: presence.counts() });
}

async function postSystem(roomId: string, user: presence.PresentUser, type: 'join' | 'leave', content: string) {
  const message = await createMessage({ roomId, user, content, type });
  emitToRoom(roomId, { type: 'message', message });
}

/** A live connection opened for this person in this room. */
export async function connectionOpened(roomId: string, user: presence.PresentUser) {
  const arrived = presence.connect(roomId, user);
  if (arrived) {
    // After a server restart everyone reconnects; don't repeat "joined" for people who never left.
    if ((await lastMembershipEvent(roomId, user.id)) !== 'join') {
      await postSystem(roomId, user, 'join', `${user.nickname} joined`);
    }
  }
  announcePresence(roomId);
}

/** A live connection closed. "left" is posted only after the grace period, if they don't come back. */
export function connectionClosed(roomId: string, userId: string) {
  presence.disconnect(roomId, userId, (user) => {
    postSystem(roomId, user, 'leave', `${user.nickname} left`).catch((err) =>
      console.error('[presence] could not post leave message', err),
    );
    announcePresence(roomId);
  });
}

export const typingChanged = (roomId: string) => emitToRoom(roomId, { type: 'typing' });
