import vinext from 'vinext';
import { defineConfig } from 'vite';
import { nitro } from 'nitro/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@progresscheck/backend': fileURLToPath(new URL('./server/supabase-route.ts', import.meta.url)) } },
  plugins: [vinext(), nitro({ preset: 'vercel' })],
});
