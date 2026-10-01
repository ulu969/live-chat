// Diagnoses the database connection: npm run db:check
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set. Run: cp .env.example .env');
  process.exit(1);
}
const safe = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');
console.log(`Connecting to ${safe}`);

const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
const hints = {
  ECONNREFUSED: 'Nothing is listening there. Start OrbStack (or Docker Desktop), then run: npm run db:up',
  '28P01': 'Password rejected: this is probably a different Postgres server. Make sure .env matches .env.example (port 5433). See README "Port clash".',
  '28000': 'That role does not exist on this server, so it is probably a different Postgres. Make sure .env matches .env.example (port 5433). See README "Port clash".',
  '3D000': 'The database does not exist on this server, so it is probably a different Postgres. Make sure .env matches .env.example (port 5433). See README "Port clash".',
};

try {
  const [{ version }] = await sql`select version()`;
  console.log(`✓ Connected: ${version.split(',')[0]}`);
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  const names = tables.map((t) => t.table_name);
  const missing = ['users', 'rooms', 'messages', 'notifications'].filter((t) => !names.includes(t));
  if (missing.length) {
    console.error(`✗ Missing tables: ${missing.join(', ')}. Run: npm run db:setup`);
    process.exitCode = 1;
  } else {
    const [lobby] = await sql`select id from rooms where id = 'lobby'`;
    if (!lobby) {
      console.error('✗ Tables exist but the Lobby is missing. Run: npm run db:seed');
      process.exitCode = 1;
    } else console.log('✓ Tables and Lobby room are in place. The database is ready.');
  }
} catch (err) {
  const code = err.code ?? err.errno;
  console.error(`✗ ${err.message}${code ? ` [${code}]` : ''}`);
  if (hints[code]) console.error(`  → ${hints[code]}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 });
}
