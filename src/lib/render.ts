/**
 * HTML partials shared by full page renders and live (SSE) pushes.
 * Every partial is rendered for a specific viewer, so "own message" styling
 * is decided on the server for each connection.
 */
import { escapeHtml, initials } from './html';
import type { ChatMessage } from './messages';

const timeTag = (d: Date) => {
  const iso = d.toISOString();
  // Text is a UTC fallback; the client script rewrites it in the viewer's local time.
  return `<time datetime="${iso}" class="local-time">${iso.slice(11, 16)}</time>`;
};

export function renderMessage(m: ChatMessage, viewerId: string): string {
  const ts = m.createdAt.getTime();
  if (m.type !== 'message' || !m.user) {
    return `<li id="msg-${m.id}" data-ts="${ts}" data-kind="system"
      class="msg-system flex items-center gap-3 px-4 py-1 text-xs text-ink-soft">
      <span class="h-px flex-1 bg-line"></span>
      <span>${escapeHtml(m.content)} · ${timeTag(m.createdAt)}</span>
      <span class="h-px flex-1 bg-line"></span>
    </li>`;
  }

  const own = m.user.id === viewerId;
  const name = escapeHtml(m.user.nickname);
  return `<li id="msg-${m.id}" data-ts="${ts}" data-user="${m.user.id}"
    class="msg group flex gap-3 px-4 py-1.5 ${own ? 'bg-own/60 hover:bg-own' : 'hover:bg-hover'}">
    <span aria-hidden="true"
      class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white"
      style="background:${escapeHtml(m.user.color)}">${escapeHtml(initials(m.user.nickname))}</span>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="name-color font-semibold" style="color:${escapeHtml(m.user.color)}">${name}</span>
        ${own ? '<span class="text-[11px] text-ink-soft">you</span>' : ''}
        <span class="text-xs text-ink-soft">${timeTag(m.createdAt)}</span>
      </div>
      <p class="whitespace-pre-wrap break-words leading-snug">${escapeHtml(m.content)}</p>
    </div>
  </li>`;
}

export const renderMessages = (list: ChatMessage[], viewerId: string) =>
  list.map((m) => renderMessage(m, viewerId)).join('');

/** "Load earlier" row at the top of the list. Replaced by the older page when triggered. */
export function renderLoadEarlier(roomId: string, oldest: ChatMessage): string {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/history?before=${oldest.createdAt.getTime()}&id=${encodeURIComponent(oldest.id)}`;
  return `<li id="load-earlier" class="flex justify-center py-2">
    <button type="button" hx-get="${url}" hx-target="#load-earlier" hx-swap="outerHTML"
      hx-trigger="click, intersect root:#scroller once"
      class="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:bg-hover hover:text-ink">
      Load earlier messages
    </button>
  </li>`;
}

export function renderBeginning(roomName: string): string {
  return `<li class="px-4 pt-2 pb-3 text-xs text-ink-soft">This is the beginning of #${escapeHtml(roomName)}.</li>`;
}

/** A page of history, oldest-first, headed by either another "Load earlier" row or the room start. */
export function renderHistoryPage(
  room: { id: string; name: string },
  page: { messages: ChatMessage[]; hasMore: boolean },
  viewerId: string,
): string {
  const head = page.hasMore && page.messages[0] ? renderLoadEarlier(room.id, page.messages[0]) : renderBeginning(room.name);
  return head + renderMessages(page.messages, viewerId);
}

export function renderRoomLink(
  room: { id: string; name: string },
  opts: { currentId?: string; standalone?: boolean; count?: number } = {},
): string {
  const current = room.id === opts.currentId;
  const cls = [
    'flex items-center gap-2 rounded-md px-3',
    opts.standalone ? 'py-3 text-base' : 'py-1.5',
    current ? 'bg-accent font-semibold text-accent-ink' : 'text-ink hover:bg-panel',
  ].join(' ');
  return `<li data-room="${escapeHtml(room.id)}">
    <a href="/rooms/${encodeURIComponent(room.id)}" class="${cls}"${current ? ' aria-current="page"' : ''}>
      <span class="opacity-60">#</span>
      <span class="min-w-0 flex-1 truncate">${escapeHtml(room.name)}</span>
      ${renderRoomCount(room.id, opts.count ?? 0)}
    </a>
  </li>`;
}

/** Online-count badge in the room list. Updated in place by the client from `counts` events. */
export function renderRoomCount(roomId: string, n: number): string {
  return `<span data-room-count="${escapeHtml(roomId)}" class="text-xs tabular-nums opacity-70"
    aria-label="${n} online"${n ? '' : ' hidden'}>${n}</span>`;
}


/** Header count, e.g. "● 3 online". */
export function renderOnlineCount(n: number): string {
  return `<span class="size-2 rounded-full ${n ? 'bg-accent' : 'bg-line'}" aria-hidden="true"></span>
    <span class="tabular-nums">${n} online</span>`;
}

/** Who's here. `data-nickname` is what @mention autocomplete will read later. */
export function renderUserList(users: { id: string; nickname: string; color: string }[], viewerId: string): string {
  if (!users.length) return '<li class="px-3 py-2 text-sm text-ink-soft">No one is here yet.</li>';
  return users
    .map(
      (u) => `<li data-user-id="${escapeHtml(u.id)}" data-nickname="${escapeHtml(u.nickname)}"
        class="flex items-center gap-2.5 px-3 py-1.5">
        <span aria-hidden="true" class="grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold text-white"
          style="background:${escapeHtml(u.color)}">${escapeHtml(initials(u.nickname))}</span>
        <span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(u.nickname)}</span>
        ${u.id === viewerId ? '<span class="text-[11px] text-ink-soft">you</span>' : ''}
      </li>`,
    )
    .join('');
}

/** "Alex is typing…", never including the viewer themselves. Empty string when nobody is. */
export function renderTyping(typists: { id: string; nickname: string }[], viewerId: string): string {
  const names = typists.filter((t) => t.id !== viewerId).map((t) => `<strong class="font-semibold">${escapeHtml(t.nickname)}</strong>`);
  if (!names.length) return '';
  const who =
    names.length === 1
      ? `${names[0]} is`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are`
        : names.length === 3
          ? `${names[0]}, ${names[1]} and ${names[2]} are`
          : 'Several people are';
  return `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> ${who} typing…`;
}
