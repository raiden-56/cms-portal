import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  // The shared package ships TypeScript source, so it is compiled into the bundle.
  noExternal: ['@meridian/shared'],
});
