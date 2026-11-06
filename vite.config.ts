import { defineConfig } from 'vite';

// `base` is relative so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
  // In the dev container, edits made on the Windows side don't raise file
  // events inside Linux, so poll there (set in .devcontainer/devcontainer.json).
  server: process.env.ATLAS_WATCH_POLL ? { watch: { usePolling: true, interval: 300 } } : {},
});
