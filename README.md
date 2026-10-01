# Live Chat

A multi-room live chat. Pick a nickname, join a room, and talk — messages, presence and typing
indicators update for everyone in the room without a refresh.

**Stack:** Astro 6 (SSR, Node adapter) · HTMX 2 + SSE extension · Alpine.js · PostgreSQL + Drizzle ORM ·
Server-Sent Events · Tailwind CSS v4

## Requirements

- Node.js 22+
- Docker Desktop (for the local PostgreSQL database)

## Setup

```bash
npm install
cp .env.example .env        # skip if .env already exists
npm run db:up               # start PostgreSQL in Docker on port 5433, wait until ready
npm run db:setup            # create tables + seed the System user and Lobby room
npm run db:check            # optional: confirms the database is reachable and set up
npm run dev                 # http://localhost:4321
```

## Environment variables

| Name           | Required | Example                                       | Notes                                   |
|----------------|----------|-----------------------------------------------|-----------------------------------------|
| `DATABASE_URL` | yes      | `postgres://chat:chat@localhost:5433/chat`    | Railway provides this for its Postgres  |
| `PORT`         | no       | `4321`                                        | Set automatically on Railway            |
| `DB_PORT`      | no       | `5433`                                        | Host port for the Docker Postgres       |
| `PRESENCE_GRACE_MS` | no  | `60000`                                       | Wait before posting "left" (lower it to test) |
| `SSE_HEARTBEAT_MS`  | no  | `30000`                                       | Interval of the keep-alive ping           |

## Scripts

| Script               | What it does                                             |
|----------------------|----------------------------------------------------------|
| `npm run dev`        | Dev server with hot reload                               |
| `npm run build`      | Production build into `dist/`                            |
| `npm start`          | Run the production build (reads `.env` if present)        |
| `npm run db:up/down` | Start / stop the Docker Postgres container                |
| `npm run db:generate`| Generate a new migration after editing `src/db/schema.ts` |
| `npm run db:setup`   | Apply migrations and seed (safe to run repeatedly)        |
| `npm run db:check`   | Diagnose the database connection and setup               |
| `npm run test:e2e`   | Build, then run the two-browser end-to-end tests          |
| `npm run test:e2e:ui`| Same, in Playwright's UI so you can watch each step       |

## How it's organised

```
src/
  db/schema.ts        4 tables: users, rooms, messages, notifications
  db/client.ts        Drizzle + postgres.js (one pool, kept across HMR)
  lib/                users, rooms, messages queries; render.ts = HTML partials per viewer
  middleware.ts       reads the chat_user_id cookie → Astro.locals.user, else redirect to /join
  pages/              join, rooms list, rooms/[id], api/*
scripts/              migrate.mjs, seed.mjs
drizzle/              generated SQL migrations
```

Saved state (users, rooms, messages, notifications) lives in Postgres. Live state (who's online,
who's typing, open connections) lives in server memory and expires on its own:

- `lib/presence.ts` — who's in each room. Counts tabs per person; "left" is posted only after a
  60 s grace period, so a refresh or brief network drop doesn't spam the room.
- `lib/typing.ts` — who's typing. Each ping lasts 2 s; sending a message clears it at once.
- `lib/bus.ts` — in-memory event bus. `room:<id>` events reach only that room's connections.

Because live state is in memory, the app runs as a single server process (one Railway instance).

## Tests

`npm run test:e2e` runs `tests/e2e/two-users.spec.ts` with Playwright (`npm run test:e2e:ui` to
watch it). Before every run it checks the database is up and builds the app, so it always tests
the current code — whether you start it via npm or `npx playwright test` directly.
It opens two separate browser sessions (Alice and Bob) and checks every item on the AGENTS.md "test with two
windows" list, plus catch-up after a dropped connection and the SSE heartbeat. The suite starts its
own server on port 4399 (with a 2 s grace period so "left" is quick to see) and restarts it
mid-run, so stop nothing else first — just have the database up.

One-time setup on a new machine: `npx playwright install chromium`.

## Real-time details

- **POST to send, SSE to receive.** `POST /api/rooms/:id/messages` saves, then emits on the in-memory
  bus; every open `GET /api/rooms/:id/stream` for that room writes it out.
- **Reconnect.** The browser reconnects by itself. On every (re)connect it sends `?since=<newest
  message on screen>` (or the standard `Last-Event-ID` header) and the server replays anything newer
  before resuming live events, so nothing is missed and nothing is shown twice. A "Reconnecting…"
  banner shows while the connection is down.
- **Heartbeat.** A `: ping` comment every 30 s (`SSE_HEARTBEAT_MS`) keeps proxies from closing idle
  connections.

## Deploying to Railway

Live connections need a server process that stays running, so this app deploys to Railway (not
serverless hosting). `railway.json` holds the settings:

- **Build:** `npm run build`  ·  **Start:** `npm start` (binds `0.0.0.0` and Railway's `PORT`)
- **Before each deploy:** `npm run db:setup` applies migrations and seeds the Lobby (safe to repeat)
- **Healthcheck:** `GET /api/health` returns 200 once the server can reach the database

One-time setup in the Railway dashboard:

1. New project → **Deploy from GitHub repo** (or `railway up` from this folder with the Railway CLI).
2. In the same project: **+ New → Database → PostgreSQL**.
3. On the app service → **Variables**: add `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
4. App service → **Settings → Networking → Generate Domain** for a public URL.
5. Keep the app at **one replica**: who's online/typing and the event bus live in that one
   process's memory.

Open the public URL in two browsers to check messages, presence and typing update live through
Railway's proxy.

## Troubleshooting

Start with `npm run db:check`. It names the problem and the fix.

**`Failed query: …` when joining.** The app reached a database that isn't set up, or the wrong
database. Run `npm run db:check`.

**Port clash.** The Docker database uses port 5433 so it doesn't collide with a Homebrew or
Postgres.app server on 5432. If you see "role "chat" does not exist" or "password authentication
failed", `DATABASE_URL` is pointing at the other server: make sure `.env` matches `.env.example`.
To use a different port, change `DB_PORT` and the port in `DATABASE_URL` together, then
`npm run db:down && npm run db:up && npm run db:setup`.

**See what's using a port:** `lsof -nP -iTCP:5433 -sTCP:LISTEN`
