import { defineConfig } from 'vite';

// `base` is relative so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
});
