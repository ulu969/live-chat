/**
 * The "test with two windows" checklist from AGENTS.md, automated with two separate
 * browser contexts (= two people with separate cookies), plus reconnect catch-up
 * and the SSE heartbeat.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AWAY_MS, GRACE_MS, HEARTBEAT_MS, PORT, restartServer, startServer, stopServer } from './server';

test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36).slice(-5);
const ALICE = `alice-${tag}`;
const BOB = `bob-${tag}`;

let aliceCtx: BrowserContext, bobCtx: BrowserContext;
let alice: Page, bob: Page;

async function joinAs(browser: Browser, nickname: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/join');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Join the Lobby' }).click();
  await page.waitForURL('**/rooms/lobby');
  return { ctx, page };
}

async function send(page: Page, text: string) {
  const box = page.locator('#message-input');
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

const message = (page: Page, text: string) => page.locator('#messages li.msg', { hasText: text });
const onlineCount = (page: Page) => page.locator('#online-count');

test.beforeAll(async () => {
  await startServer();
});
test.afterAll(async () => {
  await aliceCtx?.close();
  await bobCtx?.close();
  await stopServer();
});

test('1. Alice and Bob join the Lobby', async ({ browser }) => {
  ({ ctx: aliceCtx, page: alice } = await joinAs(browser, ALICE));
  ({ ctx: bobCtx, page: bob } = await joinAs(browser, BOB));
  await expect(alice.locator('#chat header h1')).toContainText('Lobby');
  await expect(alice.getByText(`${BOB} joined`)).toBeVisible();
});

test('2. each message appears in the other window without a refresh', async () => {
  await send(alice, `hi bob ${tag}`);
  await expect(message(bob, `hi bob ${tag}`)).toBeVisible();
  await send(bob, `hi alice ${tag}`);
  await expect(message(alice, `hi alice ${tag}`)).toBeVisible();
  // and only once on each side
  await expect(message(alice, `hi bob ${tag}`)).toHaveCount(1);
});

test('3. both see each other in the online list', async () => {
  for (const page of [alice, bob]) {
    await expect(onlineCount(page)).toContainText('2 online');
    await onlineCount(page).click();
    await expect(page.locator(`#online-list [data-nickname="${ALICE}"]`)).toBeVisible();
    await expect(page.locator(`#online-list [data-nickname="${BOB}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('4. typing indicator shows, then clears a few seconds after typing stops', async () => {
  await bob.locator('#message-input').click();
  await bob.keyboard.type('typing something');
  await expect(alice.locator('#typing')).toContainText(`${BOB} is typing`);
  await expect(bob.locator('#typing')).not.toContainText('typing'); // never yourself
  await expect(alice.locator('#typing')).toHaveText('', { timeout: 4_000 });
  await bob.locator('#message-input').fill('');
});

test('5. a message posted in another room never appears in the Lobby', async ({ browser }) => {
  const { ctx, page: carol } = await joinAs(browser, `carol-${tag}`);
  await carol.getByRole('button', { name: '+ New' }).click();
  await carol.getByLabel('Name').fill(`Elsewhere ${tag}`);
  await carol.getByRole('button', { name: 'Create room' }).click();
  await carol.waitForURL(`**/rooms/elsewhere-${tag}`);
  // the new room appears in Alice's sidebar live
  await expect(alice.locator(`#room-list [data-room="elsewhere-${tag}"]`)).toBeVisible();

  await send(carol, `secret elsewhere ${tag}`);
  await expect(message(carol, `secret elsewhere ${tag}`)).toBeVisible();
  await send(alice, `lobby marker ${tag}`); // proves Alice's stream is live after Carol's post
  await expect(message(bob, `lobby marker ${tag}`)).toBeVisible();
  await expect(alice.getByText(`secret elsewhere ${tag}`)).toHaveCount(0);
  await expect(bob.getByText(`secret elsewhere ${tag}`)).toHaveCount(0);
  await bob.reload();
  await expect(bob.getByText(`secret elsewhere ${tag}`)).toHaveCount(0);
  await ctx.close();
});

test('6. a refreshed window loads history and keeps receiving live messages', async () => {
  await bob.reload();
  await expect(message(bob, `hi bob ${tag}`)).toBeVisible();
  await send(alice, `after refresh ${tag}`);
  await expect(message(bob, `after refresh ${tag}`)).toBeVisible();
  // the refresh was inside the grace period: no "left"/"joined" spam
  await expect(alice.getByText(`${BOB} left`)).toHaveCount(0);
  await expect(alice.getByText(`${BOB} joined`)).toHaveCount(1);
});

test('catch-up: messages sent while a window was disconnected arrive once it reconnects', async () => {
  // Cut Bob off: block his live connection, then drop everyone's current connection.
  const stream = '**/api/rooms/*/stream*';
  await bob.route(stream, (route) => route.abort('internetdisconnected'));
  await restartServer();
  await expect(bob.locator('#conn-banner')).toBeVisible({ timeout: 10_000 });
  await expect(alice.locator('#conn-banner')).toBeHidden({ timeout: 15_000 });

  // Alice is live again; Bob is still down.
  await send(alice, `while you were away ${tag}`);
  await expect(message(alice, `while you were away ${tag}`)).toBeVisible();
  await expect(message(bob, `while you were away ${tag}`)).toHaveCount(0);

  // Bob's connection comes back: the missed message is replayed, exactly once.
  await bob.unroute(stream);
  await expect(bob.locator('#conn-banner')).toBeHidden({ timeout: 20_000 });
  await expect(message(bob, `while you were away ${tag}`)).toHaveCount(1);
  await send(alice, `back live ${tag}`);
  await expect(message(bob, `back live ${tag}`)).toBeVisible();
  const ids = await bob.locator('#messages li[id^="msg-"]').evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test('sleep: a connection that drops and comes back posts no "left" or "joined"', async ({ browser }) => {
  const { ctx, page: dave } = await joinAs(browser, `dave-${tag}`);
  await expect(alice.getByText(`dave-${tag} joined`)).toBeVisible();
  await expect(onlineCount(alice)).toContainText('3 online');

  // Like a laptop dozing off: the connection drops with no "page closing" signal,
  // and stays down longer than the grace period.
  const stream = '**/api/rooms/*/stream*';
  await dave.route(stream, (route) => route.abort('internetdisconnected'));
  await dave.evaluate(() => {
    const src = (document.getElementById('live') as any)['htmx-internal-data'].sseEventSource as EventSource;
    src.close();
    src.onerror?.(new Event('error')); // let the SSE extension start reconnecting, as after a real drop
  });
  await expect(onlineCount(alice)).toContainText('2 online', { timeout: GRACE_MS + 5_000 }); // shown offline…
  await expect(alice.getByText(`dave-${tag} left`)).toHaveCount(0); // …but not announced

  // Wakes up: the same page reconnects silently.
  await dave.unroute(stream);
  await expect(onlineCount(alice)).toContainText('3 online', { timeout: 20_000 });
  await expect(alice.getByText(`dave-${tag} joined`)).toHaveCount(1);
  await expect(alice.getByText(`dave-${tag} left`)).toHaveCount(0);
  await ctx.close();
});

test('fallback: a page that vanishes without a close signal is announced as left after a while', async ({ browser }) => {
  const { ctx, page: erin } = await joinAs(browser, `erin-${tag}`);
  await expect(alice.getByText(`erin-${tag} joined`)).toBeVisible();
  // No beacon (e.g. a phone killed the tab), then the page goes away.
  await erin.evaluate(() => (navigator.sendBeacon = () => true));
  const goneAt = Date.now();
  await erin.goto('about:blank');
  await expect(alice.getByText(`erin-${tag} left`)).toHaveCount(0, { timeout: 1_000 });
  await alice.waitForTimeout(GRACE_MS + 1_000);
  await expect(alice.getByText(`erin-${tag} left`)).toHaveCount(0); // past the grace period: still quiet
  await expect(alice.getByText(`erin-${tag} left`)).toBeVisible({ timeout: AWAY_MS + 5_000 });
  expect(Date.now() - goneAt).toBeGreaterThanOrEqual(AWAY_MS - 500);
  // Coming back for real (a fresh page) announces "joined" again.
  await erin.goto('/rooms/lobby');
  await expect(alice.getByText(`erin-${tag} joined`)).toHaveCount(2);
  await ctx.close();
});

test('Exit announces "left" right away', async ({ browser }) => {
  const { page: finn } = await joinAs(browser, `finn-${tag}`);
  await expect(alice.getByText(`finn-${tag} joined`)).toBeVisible();
  const t = Date.now();
  await finn.getByRole('button', { name: 'Exit' }).click();
  await finn.waitForURL('**/join');
  await expect(alice.getByText(`finn-${tag} left`)).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - t).toBeLessThan(GRACE_MS + 500);
  await finn.context().close();
});

test('heartbeat: the stream sends a ping comment to keep proxies from closing it', async () => {
  const cookie = (await aliceCtx.cookies()).find((c) => c.name === 'chat_user_id')!;
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/rooms/lobby/stream`, {
    headers: { cookie: `chat_user_id=${cookie.value}` },
    signal: ctrl.signal,
  });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  const until = Date.now() + HEARTBEAT_MS * 3;
  while (Date.now() < until && !text.includes(': ping')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  ctrl.abort();
  expect(text).toContain(': ping');
});

test('8. after a server restart both windows reconnect on their own and every message is still there', async () => {
  await restartServer();
  for (const page of [alice, bob]) {
    await expect(page.locator('#conn-banner')).toBeHidden({ timeout: 20_000 });
  }
  // live again, both directions
  await send(alice, `after restart ${tag}`);
  await expect(message(bob, `after restart ${tag}`)).toBeVisible({ timeout: 10_000 });
  await send(bob, `restart reply ${tag}`);
  await expect(message(alice, `restart reply ${tag}`)).toBeVisible();
  // everything is still in the database
  await bob.reload();
  for (const text of [`hi bob ${tag}`, `hi alice ${tag}`, `after refresh ${tag}`, `while you were away ${tag}`, `after restart ${tag}`]) {
    await expect(message(bob, text)).toHaveCount(1);
  }
  // reconnecting after the restart didn't post "joined" again
  await expect(bob.getByText(`${ALICE} joined`)).toHaveCount(1);
  await expect(onlineCount(alice)).toContainText('2 online');
});

test('7. closing a window shows that person leaving after the grace period', async () => {
  await bobCtx.close();
  const closedAt = Date.now();
  await expect(alice.getByText(`${BOB} left`)).toBeVisible({ timeout: GRACE_MS + 5_000 });
  expect(Date.now() - closedAt).toBeGreaterThanOrEqual(GRACE_MS - 200);
  await expect(onlineCount(alice)).toContainText('1 online');
});
