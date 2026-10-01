// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true, port: Number(process.env.PORT) || 4321 },
  // Railway (and other proxies) can make the Origin header mismatch; the
  // httpOnly SameSite=Lax cookie still blocks cross-site POSTs.
  security: { checkOrigin: false },
  // Server-only settings, read from the environment when the server starts. They're all
  // `secret` because Astro inlines `public` server values at build time; `secret` ones are
  // read at runtime. Locally they come from .env; on Railway from service variables.
  env: {
    schema: {
      DATABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      PRESENCE_GRACE_MS: envField.number({ context: 'server', access: 'secret', default: 60_000 }),
      SSE_HEARTBEAT_MS: envField.number({ context: 'server', access: 'secret', default: 30_000 }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // Pre-bundle client deps so the first page load doesn't trigger a Vite re-optimize + reload.
    optimizeDeps: { include: ['htmx.org', 'htmx-ext-sse', 'alpinejs'] },
  },
});
