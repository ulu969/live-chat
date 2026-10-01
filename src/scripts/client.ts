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
(htmx as any).createEventSource = (url: string) => {
  const since = resumeFrom();
  return new EventSource(since ? `${url}${url.includes('?') ? '&' : '?'}since=${since}` : url);
};

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
});

// ---- Composer ----------------------------------------------------------------
// Clears the box the instant you send so you can keep typing, and posts messages
// strictly in order. The message comes back to every window (yours too) over SSE.
const TYPING_EVERY_MS = 1_500; // server expires typing after 2 s, so ping a bit faster

Alpine.data('composer', () => ({
  error: '',
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
