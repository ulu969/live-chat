import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DATABASE_URL as url } from 'astro:env/server';
import * as schema from './schema';

// Keep one pool across Vite HMR reloads in dev.
const g = globalThis as unknown as { __chatSql?: ReturnType<typeof postgres> };
const client = (g.__chatSql ??= postgres(url, { max: 10 }));

export const db = drizzle(client, { schema });
export { schema };
