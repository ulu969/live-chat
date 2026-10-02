/**
 * In-memory event bus. A POST saves to the database and then emits here; every
 * open SSE connection that cares is listening and writes the event to its stream.
 *  - room:<id>  events for one room only (messages). Other rooms never see them.
 *  - user:<id>   events for one person on every page they have open (an @mention).
 *  - global     app-wide events (a room was created, online counts changed, someone renamed).
 * Stored on globalThis so Vite HMR in dev doesn't create a second, disconnected bus.
 */
import { EventEmitter } from 'node:events';
import type { ChatMessage } from './messages';
import type { Room } from '../db/schema';

export type RoomEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'presence' } // who's online changed; each connection re-renders count + list
  | { type: 'typing' }; // who's typing changed; each connection renders it without its own name
/** Events for one person, wherever they have the app open. */
export type UserEvent = { type: 'mention'; notificationId: string; unread: number };

export type GlobalEvent =
  | { type: 'newroom'; room: Room }
  | { type: 'counts'; counts: Record<string, number> } // online count per room, for sidebars
  | { type: 'renamed'; user: { id: string; nickname: string } }; // update names already on screen

const g = globalThis as unknown as { __chatBus?: EventEmitter };
export const bus = (g.__chatBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0); // one listener per open connection; no artificial cap
  return e;
})());

const roomChannel = (roomId: string) => `room:${roomId}`;

export function emitToRoom(roomId: string, event: RoomEvent) {
  bus.emit(roomChannel(roomId), event);
}

export function onRoom(roomId: string, fn: (e: RoomEvent) => void) {
  bus.on(roomChannel(roomId), fn);
  return () => bus.off(roomChannel(roomId), fn);
}

export function emitGlobal(event: GlobalEvent) {
  bus.emit('global', event);
}

export function onGlobal(fn: (e: GlobalEvent) => void) {
  bus.on('global', fn);
  return () => bus.off('global', fn);
}

export function emitToUser(userId: string, event: UserEvent) {
  bus.emit(`user:${userId}`, event);
}

export function onUser(userId: string, fn: (e: UserEvent) => void) {
  bus.on(`user:${userId}`, fn);
  return () => bus.off(`user:${userId}`, fn);
}
