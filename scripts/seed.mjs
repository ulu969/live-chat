import postgres from 'postgres';
import { waitForDb } from './wait-for-db.mjs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
await waitForDb(sql);

await sql`insert into users (id, nickname, color) values ('system', 'System', '#666666') on conflict (id) do nothing`;
await sql`insert into rooms (id, name, description, created_by)
          values ('lobby', 'Lobby', 'The default room', 'system') on conflict (id) do nothing`;
console.log('✓ seeded System user and Lobby room');
await sql.end();
