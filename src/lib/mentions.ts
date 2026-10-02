/**
 * @mentions. Nicknames may contain spaces, dots and dashes ("Mary Jo", "j.r"), so a
 * mention is "@" followed by a *known* nickname (case-insensitive), not just "@word".
 * The longest name wins, so "@Mary Jo" isn't read as "@Mary". A mention must end at a
 * non-word character, so "@bob" doesn't match inside "@bobby". "@everyone" mentions
 * everyone currently in the room and is shown as "@EVERYONE".
 *
 * Known nicknames are cached in memory (one small query at startup), and kept current
 * when people join or rename.
 */
import { ne } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { escapeHtml } from './html';

type Person = { id: string; nickname: string };

const g = globalThis as unknown as { __chatNames?: Map<string, Person>; __chatNamesReady?: Promise<void> };
const names: Map<string, Person> = (g.__chatNames ??= new Map()); // lower(nickname) -> person

/** Load every nickname once. Cheap to await on every request after the first. */
export function ensureNames(): Promise<void> {
  return (g.__chatNamesReady ??= db
    .select({ id: schema.users.id, nickname: schema.users.nickname })
    .from(schema.users)
    .where(ne(schema.users.id, 'system'))
    .then((rows) => {
      for (const r of rows) names.set(r.nickname.toLowerCase(), r);
    })
    .catch((err) => {
      g.__chatNamesReady = undefined; // try again next request
      throw err;
    }));
}

/** Keep the cache current after a join or a rename. */
export function rememberName(person: Person, oldNickname?: string) {
  if (oldNickname) names.delete(oldNickname.toLowerCase());
  names.set(person.nickname.toLowerCase(), person);
}

export const EVERYONE = 'everyone';
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

type Segment = { text: string } | { mention: Person | typeof EVERYONE; raw: string };

/** Split message text into plain text and mentions. */
export function tokenize(content: string): Segment[] {
  const out: Segment[] = [];
  const lower = content.toLowerCase();
  let plainStart = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '@' || isWordChar(content[i - 1])) continue;
    // Longest known name (or "everyone") that starts right after the "@".
    let best: { len: number; who: Person | typeof EVERYONE } | null = null;
    const rest = lower.slice(i + 1);
    if (rest.startsWith(EVERYONE) && !isWordChar(rest[EVERYONE.length])) best = { len: EVERYONE.length, who: EVERYONE };
    for (const [key, person] of names) {
      if (key.length > (best?.len ?? 0) && rest.startsWith(key) && !isWordChar(rest[key.length])) {
        best = { len: key.length, who: person };
      }
    }
    if (!best) continue;
    if (i > plainStart) out.push({ text: content.slice(plainStart, i) });
    out.push({ mention: best.who, raw: content.slice(i, i + 1 + best.len) });
    i += best.len;
    plainStart = i + 1;
  }
  if (plainStart < content.length) out.push({ text: content.slice(plainStart) });
  return out;
}

/** Who a message mentions. */
export function findMentions(content: string): { userIds: Set<string>; everyone: boolean } {
  const userIds = new Set<string>();
  let everyone = false;
  for (const s of tokenize(content)) {
    if (!('mention' in s)) continue;
    if (s.mention === EVERYONE) everyone = true;
    else userIds.add(s.mention.id);
  }
  return { userIds, everyone };
}

/**
 * Message text as safe HTML with mentions highlighted. `mentionsViewer` is true when
 * the viewer is mentioned by name or via @everyone (their copy of the message stands out).
 */
export function renderContent(content: string, viewerId: string): { html: string; mentionsViewer: boolean } {
  let html = '';
  let mentionsViewer = false;
  for (const s of tokenize(content)) {
    if (!('mention' in s)) {
      html += escapeHtml(s.text);
    } else if (s.mention === EVERYONE) {
      mentionsViewer = true;
      html += '<span class="mention mention-everyone">@EVERYONE</span>';
    } else {
      const me = s.mention.id === viewerId;
      if (me) mentionsViewer = true;
      html += `<span class="mention${me ? ' mention-me' : ''}" data-mention="${escapeHtml(s.mention.id)}">${escapeHtml(s.raw)}</span>`;
    }
  }
  return { html, mentionsViewer };
}
