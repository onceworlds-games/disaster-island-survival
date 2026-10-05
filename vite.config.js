import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the game is served from its own origin on Onceworlds, and pinned deploys from other hosts.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
  },
});
