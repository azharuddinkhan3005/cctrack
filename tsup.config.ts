import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: false,
  minify: false,
  treeshake: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
