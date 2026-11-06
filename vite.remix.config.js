// A readable copy of the game for Onceworlds Remix: one file per module, not minified, at <outDir>/_remix. Players never load it;
// the platform copies it, instead of the bundle, when someone remixes the game.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default defineConfig(async (env) => {
  const config = typeof base === 'function' ? await base(env) : base;
  // A single-bundle setting can't apply to one file per module.
  const inherited = config.build?.rollupOptions?.output;
  if (inherited && !Array.isArray(inherited)) delete inherited.manualChunks;
  return mergeConfig(config, {
    publicDir: false,
    plugins: [
      {
        name: 'remix-only-entry',
        enforce: 'post',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            const tags = [...html.matchAll(/\s*<script type="module"[^>]*\ssrc="[^"]+"[^>]*><\/script>/g)].map((m) => m[0]);
            return tags.slice(0, -1).reduce((page, tag) => page.replace(tag, ''), html).replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
          },
        },
      },
    ],
    build: {
      outDir: `${config.build?.outDir ?? 'dist'}/_remix`,
      emptyOutDir: false,
      minify: false,
      cssMinify: false,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        output: {
          preserveModules: true,
          preserveModulesRoot: process.cwd(),
          entryFileNames: (chunk) => `${chunk.name.replace(/^node_modules\//, 'lib/').replace(/\/node_modules\//g, '/lib/')}.js`,
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  });
});
