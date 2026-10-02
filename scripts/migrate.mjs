import postgres from 'postgres';
import { waitForDb } from './wait-for-db.mjs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
await waitForDb(sql);
await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
console.log('✓ migrations applied');
await sql.end();
