// One-off cleanup of repeated "X joined" / "X left" lines (e.g. a laptop waking and
// sleeping overnight before presence ignored reconnects).
//
//   node scripts/cleanup-presence-spam.mjs            # preview only (default)
//   node scripts/cleanup-presence-spam.mjs --apply    # delete, in one transaction
//
// For every run of 3+ join/leave lines by the same person in a room with no chat
// messages in between (other people's join/leave lines don't break a run), keep the first line, and the last one only if it differs
// in kind from the first. So "joined … left" stays as "joined, left", and
// "joined … joined" (still there) stays as "joined". Chat messages are never touched.
import postgres from 'postgres';
import { waitForDb } from './wait-for-db.mjs';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. For Railway, use the Postgres DATABASE_PUBLIC_URL (see README).');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10, ssl: local ? false : 'prefer' });
await waitForDb(sql, { attempts: 3 });

const rows = await sql`
  select m.id, m.room_id, m.user_id, m.type, m.created_at, u.nickname
  from messages m left join users u on u.id = m.user_id
  order by m.room_id, m.created_at, m.id`;

const toDelete = [];
const report = [];
const fmt = (d) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// Per room, track each person's current run of join/leave lines. A chat message from
// anyone ends every run in that room; other people's join/leave lines don't.
const flush = (run) => {
  if (run.length < 3) return;
  const first = run[0];
  const last = run[run.length - 1];
  const keep = new Set([first.id]);
  if (last.type !== first.type) keep.add(last.id);
  const drop = run.filter((r) => !keep.has(r.id));
  toDelete.push(...drop.map((r) => r.id));
  report.push(
    `#${first.room_id}  ${first.nickname}: ${run.length} lines ${fmt(first.created_at)} → ${fmt(last.created_at)}` +
      `  keep ${keep.size} (${run.filter((r) => keep.has(r.id)).map((r) => r.type).join(', ')}), delete ${drop.length}`,
  );
};
let room = null;
let runs = new Map(); // user_id -> rows
const flushAll = () => { for (const run of runs.values()) flush(run); runs = new Map(); };
for (const r of rows) {
  if (r.room_id !== room) { flushAll(); room = r.room_id; }
  const isMembership = (r.type === 'join' || r.type === 'leave') && r.user_id;
  if (!isMembership) { flushAll(); continue; }
  if (!runs.has(r.user_id)) runs.set(r.user_id, []);
  runs.get(r.user_id).push(r);
}
flushAll();

if (!toDelete.length) {
  console.log('Nothing to clean up: no runs of 3+ joined/left lines.');
} else {
  console.log(report.join('\n'));
  console.log(`\nTotal: ${toDelete.length} system lines to delete across ${report.length} run(s).`);
  if (apply) {
    await sql.begin(async (tx) => {
      for (let k = 0; k < toDelete.length; k += 500) {
        await tx`delete from messages where id in ${tx(toDelete.slice(k, k + 500))} and type in ('join', 'leave')`;
      }
    });
    console.log(`✓ Deleted ${toDelete.length} lines.`);
  } else {
    console.log('Preview only. Run again with --apply to delete them.');
  }
}
await sql.end();
