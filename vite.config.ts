// vite.config.ts (云函数集成)
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin-cloudflare';

export default defineConfig({
  plugins: [cloudflare({
    worker: {
      configPath: './cloudflare/worker.js',
      watch: true,
    },
  })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY),
  },
});