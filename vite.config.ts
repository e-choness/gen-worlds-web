// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // '/' on the custom domain; the Pages workflow sets VITE_BASE for the github.io project path.
  base: process.env.VITE_BASE ?? '/',
  // Every cache stays inside the project folder (never the system temp or node_modules/.vite).
  cacheDir: '.cache/vite',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['web'],
    // The project is bind-mounted from Windows into Docker: inotify does not cross that boundary.
    watch: { usePolling: true, interval: 300, ignored: ['**/.research/**', '**/.cache/**', '**/shots/**'] },
  },
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true, chunkSizeWarningLimit: 2500 },
  optimizeDeps: { entries: ['index.html'] },
  // Only our own pure-logic tests: .research/ holds cloned repos with their own suites.
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
