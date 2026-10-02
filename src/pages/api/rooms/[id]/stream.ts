import type { APIRoute } from 'astro';
import { getRoom, listRoomsSince } from '../../../../lib/rooms';
import { listMessagesSince } from '../../../../lib/messages';
import { onGlobal, onRoom } from '../../../../lib/bus';
import { isFreshPage, online } from '../../../../lib/presence';
import { typists } from '../../../../lib/typing';
import { connectionClosed, connectionOpened } from '../../../../lib/live';
import { renderMessage, renderOnlineCount, renderRoomLink, renderTyping, renderUserList } from '../../../../lib/render';
import { sseEvent } from '../../../../lib/sse';
import { resumePoint, sseResponse } from '../../../../lib/sse-stream';

/**
 * The live connection for one room. Events:
 *  message  – a chat or system message (HTML)
 *  presence – online count (HTML)        userlist – who's online (HTML)
 *  typing   – who's typing (HTML)        newroom  – a room was created (HTML)
 *  counts   – online count per room (JSON, for sidebar badges)
 *  renamed  – someone changed their nickname (JSON, to update names on screen)
 * Every HTML payload is rendered for this connection's viewer.
 *
 * On every (re)connect the browser says where it left off (?since / Last-Event-ID) and we
 * replay messages and rooms it missed before resuming live events.
 */
export const GET: APIRoute = async ({ params, locals, request }) => {
  const room = await getRoom(params.id!);
  if (!room) return new Response('Room not found', { status: 404 });
  const { id, nickname, color } = locals.user;
  const viewer = { id, nickname, color };
  const since = resumePoint(request);
  // First connection from a newly rendered page = a real visit; later ones are reconnects.
  const freshPage = isFreshPage(new URL(request.url).searchParams.get('page'));

  const replay = async (send: (chunk: string) => void) => {
    if (since) {
      const [missed, newRooms] = await Promise.all([listMessagesSince(room.id, since), listRoomsSince(since)]);
      for (const m of missed) send(sseEvent('message', renderMessage(m, viewer.id), m.createdAt.getTime()));
      for (const r of newRooms) send(sseEvent('newroom', renderRoomLink(r, { currentId: room.id })));
    }
    send(sseEvent('typing', renderTyping(typists(room.id), viewer.id)));
  };

  return sseResponse(request, (send) => {
    const offRoom = onRoom(room.id, (e) => {
      if (e.type === 'message') {
        send(sseEvent('message', renderMessage(e.message, viewer.id), e.message.createdAt.getTime()));
      } else if (e.type === 'presence') {
        const people = online(room.id);
        send(sseEvent('presence', renderOnlineCount(people.length)));
        send(sseEvent('userlist', renderUserList(people, viewer.id)));
      } else if (e.type === 'typing') {
        send(sseEvent('typing', renderTyping(typists(room.id), viewer.id)));
      }
    });
    const offGlobal = onGlobal((e) => {
      if (e.type === 'newroom') send(sseEvent('newroom', renderRoomLink(e.room, { currentId: room.id })));
      else if (e.type === 'counts') send(sseEvent('counts', JSON.stringify(e.counts)));
      else if (e.type === 'renamed') send(sseEvent('renamed', JSON.stringify(e.user)));
    });

    // Subscribed first, so this person sees their own "joined" message.
    connectionOpened(room.id, viewer, freshPage).catch((err) => console.error('[presence] join failed', err));

    return () => {
      offRoom();
      offGlobal();
      connectionClosed(room.id, viewer.id);
    };
  }, replay);
};
