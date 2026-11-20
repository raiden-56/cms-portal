import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5180,
    strictPort: true,
    // Browser-test output lands inside this folder. Watching it reloads the page under test every
    // time a trace file is written, and on Windows can crash the dev server on a locked file.
    watch: { ignored: ['**/test-results*/**', '**/playwright-report/**'] },
  },
  preview: { port: 5180, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    // No manual vendor chunks. Naming them by package made the chunks import each other in a
    // circle (mui ↔ code ↔ charts), which left the JSX runtime undefined when the bundle loaded:
    // the build succeeded but the app opened to a blank page. Every screen is already loaded
    // lazily, and Rollup splits the libraries they share without creating cycles.
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
