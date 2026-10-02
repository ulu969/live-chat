// On Railway the private network to Postgres can take a few seconds to come up
// after a container starts. Retry the first connection instead of failing.
export async function waitForDb(sql, { attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await sql`select 1`;
      if (i > 1) console.log(`✓ database reachable (attempt ${i})`);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`… waiting for database (${err.code ?? err.message}), retry ${i}/${attempts - 1}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
