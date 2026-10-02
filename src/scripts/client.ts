import htmx from 'htmx.org';
import 'htmx-ext-sse';
import Alpine from 'alpinejs';

declare global {
  interface Window {
    htmx: typeof htmx;
    Alpine: typeof Alpine;
  }
}
window.htmx = htmx;

// ---- Resume where we left off ------------------------------------------------
// The SSE extension opens a brand-new EventSource after a hard failure (e.g. a server
// restart), which loses the browser's Last-Event-ID. So every (re)connect adds
// ?since=<newest thing on screen> and the server replays anything newer.
function resumeFrom(): number {
  const live = document.getElementById('live');
  const rendered = Number(live?.dataset.since ?? 0);
  const last = document.querySelector<HTMLElement>('#messages > li[data-ts]:last-of-type');
  const lastMsg = Number(last?.dataset.ts ?? 0);
  return Math.max(rendered, lastMsg);
}
let currentSource: EventSource | null = null;
(htmx as any).createEventSource = (url: string) => {
  const since = resumeFrom();
  currentSource = new EventSource(since ? `${url}${url.includes('?') ? '&' : '?'}since=${since}` : url);
  return currentSource;
};

// ---- Leaving vs. dozing off ----------------------------------------------------------
// Tell the server when a room page is really closing (tab closed, navigating away,
// refresh). Without this signal a dropped connection is treated as sleep or a network
// blip, and "left" is only announced if the person stays away for a long while.
window.addEventListener('pagehide', () => {
  const room = document.getElementById('live')?.dataset.room;
  if (room) navigator.sendBeacon(`/api/rooms/${encodeURIComponent(room)}/leave`);
});
// Restored from the back/forward cache: its live connection is gone, so load it fresh.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && document.getElementById('live')) location.reload();
});
// Waking up or coming back online: the browser retries a dropped connection every 2 s by
// itself, but after a server error the SSE extension backs off for up to a minute. If the
// connection has given up, reload (replay fills in anything missed).
function reviveIfClosed() {
  if (document.visibilityState === 'visible' && currentSource?.readyState === EventSource.CLOSED) location.reload();
}
document.addEventListener('visibilitychange', reviveIfClosed);
window.addEventListener('online', reviveIfClosed);

// ---- Connection status ---------------------------------------------------------
// Show "Reconnecting…" if the live connection has been down for more than a moment.
let downTimer: ReturnType<typeof setTimeout> | undefined;
let leaving = false;
const banner = () => document.getElementById('conn-banner');
document.addEventListener('htmx:sseError', () => {
  if (downTimer || leaving) return;
  downTimer = setTimeout(() => banner()?.removeAttribute('hidden'), 1_000);
});
document.addEventListener('htmx:sseOpen', () => {
  clearTimeout(downTimer);
  downTimer = undefined;
  banner()?.setAttribute('hidden', '');
});
// Leaving the page closes the stream on purpose; that isn't a connection problem.
window.addEventListener('pagehide', () => {
  leaving = true;
  clearTimeout(downTimer);
});
window.addEventListener('pageshow', () => (leaving = false));

// ---- Theme ---------------------------------------------------------------
function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}
const themeStore = {
  dark: document.documentElement.classList.contains('dark'),
  toggle(this: { dark: boolean }) {
    this.dark = !this.dark;
    applyTheme(this.dark);
    try {
      localStorage.setItem('theme', this.dark ? 'dark' : 'light');
    } catch {}
  },
};
Alpine.store('theme', themeStore);

// ---- Local times -----------------------------------------------------------
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export function localizeTimes(root: ParentNode = document) {
  root.querySelectorAll<HTMLTimeElement>('time.local-time:not([data-done])').forEach((t) => {
    const d = new Date(t.dateTime);
    t.textContent = timeFmt.format(d);
    t.title = d.toLocaleString();
    t.dataset.done = '1';
  });
}
document.addEventListener('DOMContentLoaded', () => localizeTimes());
document.addEventListener('htmx:afterSwap', (e) => localizeTimes((e.target as Element) ?? document));
document.addEventListener('htmx:sseMessage', () => localizeTimes());

// ---- JSON events on the live connection --------------------------------------
// Most events are HTML that htmx swaps in via sse-swap. `counts` is JSON (online
// people per room) and updates every room badge in the sidebar.
const wired = new WeakSet<EventSource>();
document.addEventListener('htmx:sseOpen', (e) => {
  const source = (e as CustomEvent).detail.source as EventSource;
  if (wired.has(source)) return; // onopen fires again after each automatic reconnect
  wired.add(source);
  source.addEventListener('counts', (ev) => {
    const counts = JSON.parse((ev as MessageEvent).data) as Record<string, number>;
    document.querySelectorAll<HTMLElement>('[data-room-count]').forEach((el) => {
      const n = counts[el.dataset.roomCount!] ?? 0;
      el.textContent = String(n);
      el.hidden = n === 0;
      el.setAttribute('aria-label', `${n} online`);
    });
  });
  // You were @mentioned (in any room): update the bell, add the item, play the chime.
  source.addEventListener('mention', (ev) => {
    const { unread, html } = JSON.parse((ev as MessageEvent).data) as { unread: number; html: string };
    const bell = Alpine.store('bell') as typeof bellStore;
    bell.unread = unread;
    const list = document.getElementById('bell-list');
    if (bell.loaded && list) {
      list.querySelector('li:not([data-notification])')?.remove(); // "No mentions yet"
      list.insertAdjacentHTML('afterbegin', html);
      localizeTimes(list);
    }
    sounds.mention();
  });
  // Someone changed their nickname: update it everywhere it's already on screen.
  source.addEventListener('renamed', (ev) => {
    const { id, nickname } = JSON.parse((ev as MessageEvent).data) as { id: string; nickname: string };
    const sel = CSS.escape(id);
    document.querySelectorAll(`#messages li[data-user="${sel}"] .msg-name, [data-user-name="${sel}"]`).forEach((el) => {
      el.textContent = nickname;
    });
    document
      .querySelectorAll(`#messages li[data-user="${sel}"] .msg-avatar, [data-user-initials="${sel}"]`)
      .forEach((el) => (el.textContent = initials(nickname)));
  });
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

// ---- Sounds ----------------------------------------------------------------------
// Synthesized with Web Audio, so there are no sound files to load. A soft blip for new
// messages, a brighter two-note chime when you're @mentioned. Mute is remembered per browser.
let audio: AudioContext | null = null;
const unlockAudio = () => {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
};
// Browsers only allow sound after the person has interacted with the page.
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, unlockAudio, { capture: true }));

function tone(freq: number, start: number, dur: number, gain: number) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime + start;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const readSoundPref = () => {
  try {
    return localStorage.getItem('sound') !== 'off';
  } catch {
    return true;
  }
};
const soundStore = {
  on: readSoundPref(),
  toggle(this: { on: boolean }) {
    this.on = !this.on;
    try {
      localStorage.setItem('sound', this.on ? 'on' : 'off');
    } catch {}
    if (this.on) {
      unlockAudio();
      tone(660, 0, 0.12, 0.05); // a little confirmation blip
    }
  },
};
Alpine.store('sound', soundStore);

let lastSound = 0;
let pendingMessageSound: ReturnType<typeof setTimeout> | undefined;
export const sounds = {
  /** New message from someone else. Waits a moment in case it's a mention (which gets the chime). */
  message() {
    if (!soundStore.on || Date.now() - lastSound < 1200) return;
    clearTimeout(pendingMessageSound);
    pendingMessageSound = setTimeout(() => {
      lastSound = Date.now();
      tone(520, 0, 0.14, 0.035);
    }, 250);
  },
  mention() {
    clearTimeout(pendingMessageSound);
    if (!soundStore.on) return;
    lastSound = Date.now();
    tone(784, 0, 0.18, 0.07);
    tone(1175, 0.12, 0.3, 0.06);
  },
};

// New chat message from someone else in this room (duplicates were already dropped before
// the swap, and system lines like "joined" stay silent).
document.addEventListener('htmx:sseMessage', (e) => {
  const evt = (e as CustomEvent).detail as MessageEvent;
  if (evt.type !== 'message' || !/class="msg /.test(evt.data)) return;
  const me = document.getElementById('live')?.dataset.me;
  if (me && evt.data.includes(`data-user="${me}"`)) return;
  sounds.message();
});

// ---- Notification bell -------------------------------------------------------------
const bellStore = {
  unread: 0,
  loaded: false,
  async load(this: { loaded: boolean }) {
    const list = document.getElementById('bell-list');
    if (!list) return;
    const res = await fetch('/api/notifications', { headers: { 'HX-Request': 'true' } });
    if (!res.ok) return;
    list.innerHTML = await res.text();
    localizeTimes(list);
    this.loaded = true;
  },
  async markAllRead(this: { unread: number }) {
    const res = await fetch('/api/notifications/read', { method: 'POST' });
    if (!res.ok) return;
    this.unread = 0;
    document.querySelectorAll('#bell-list .notif-unread').forEach((el) => el.classList.remove('notif-unread'));
  },
};
Alpine.store('bell', bellStore);

// ---- Composer ----------------------------------------------------------------
// Clears the box the instant you send so you can keep typing, and posts messages
// strictly in order. The message comes back to every window (yours too) over SSE.
const TYPING_EVERY_MS = 1_500; // server expires typing after 2 s, so ping a bit faster

Alpine.data('composer', () => ({
  error: '',
  // @mention autocomplete state
  mentionOpen: false,
  mentionItems: [] as string[],
  mentionIndex: 0,
  mentionStart: -1,
  /** Who can be mentioned: people online in this room (from the online list) + "everyone". */
  candidates(): string[] {
    const me = document.getElementById('live')?.dataset.me;
    const people = [...document.querySelectorAll<HTMLElement>('#online-list li[data-nickname]')]
      .filter((li) => li.dataset.userId !== me)
      .map((li) => li.dataset.nickname!);
    return [...people, 'everyone'];
  },
  /** Open, filter or close the dropdown based on the "@word" just before the caret. */
  updateMention() {
    const el = this.input();
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const at = before.lastIndexOf('@');
    const query = at >= 0 ? before.slice(at + 1) : '';
    const valid = at >= 0 && (at === 0 || /\s/.test(before[at - 1]!)) && !/\n/.test(query) && query.length <= 24;
    if (!valid) return this.closeMention();
    const q = query.toLowerCase();
    const items = this.candidates().filter((n) => n.toLowerCase().startsWith(q)).slice(0, 8);
    if (!items.length || (items.length === 1 && items[0]!.toLowerCase() === q)) return this.closeMention();
    this.mentionItems = items;
    this.mentionStart = at;
    if (!this.mentionOpen || this.mentionIndex >= items.length) this.mentionIndex = 0;
    this.mentionOpen = true;
  },
  closeMention() {
    this.mentionOpen = false;
    this.mentionItems = [];
    this.mentionStart = -1;
  },
  pickMention(name: string) {
    const el = this.input();
    const caret = el.selectionStart ?? el.value.length;
    const insert = `@${name} `;
    el.value = el.value.slice(0, this.mentionStart) + insert + el.value.slice(caret);
    const pos = this.mentionStart + insert.length;
    el.setSelectionRange(pos, pos);
    el.focus();
    this.closeMention();
    this.grow();
  },
  /** Keys in the message box: the dropdown takes arrows/Tab/Enter/Esc while it's open. */
  onKey(e: KeyboardEvent) {
    if (this.mentionOpen) {
      const n = this.mentionItems.length;
      if (e.key === 'ArrowDown') return e.preventDefault(), (this.mentionIndex = (this.mentionIndex + 1) % n);
      if (e.key === 'ArrowUp') return e.preventDefault(), (this.mentionIndex = (this.mentionIndex - 1 + n) % n);
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        return this.pickMention(this.mentionItems[this.mentionIndex]!);
      }
      if (e.key === 'Escape') return e.preventDefault(), this.closeMention();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
    }
  },
  queue: Promise.resolve() as Promise<unknown>,
  lastTyping: 0,
  /** Tell the room we're typing, at most every 1.5 s while keys are pressed. */
  typing() {
    const el = this.input();
    if (!el.value.trim()) return;
    const now = Date.now();
    if (now - this.lastTyping < TYPING_EVERY_MS) return;
    this.lastTyping = now;
    const url = (el.form as HTMLFormElement).action.replace(/\/messages$/, '/typing');
    fetch(url, { method: 'POST' }).catch(() => {});
  },
  input(): HTMLTextAreaElement {
    return (this as any).$refs.input;
  },
  grow() {
    const el = this.input();
    el.style.height = '';
    el.style.height = el.scrollHeight + 'px';
  },
  send() {
    const el = this.input();
    const content = el.value.trim();
    if (!content) return;
    const url = (el.form as HTMLFormElement).action;
    el.value = '';
    this.closeMention();
    this.grow();
    this.error = '';
    this.lastTyping = 0; // the server clears our typing state when the message lands
    this.queue = this.queue.then(async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ content }),
          headers: { 'HX-Request': 'true' },
        });
        if (!res.ok) throw new Error((await res.text()) || 'Message not sent. Try again.');
      } catch (err) {
        this.error =
          err instanceof TypeError
            ? 'Could not reach the server. Check your connection and try again.'
            : (err as Error).message;
        // Give the text back so nothing typed is lost.
        el.value = el.value ? `${content}\n${el.value}` : content;
        this.grow();
      }
    });
  },
}));

window.Alpine = Alpine;
Alpine.start();
