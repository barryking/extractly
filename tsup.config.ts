import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/markdown-entry.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
    splitting: true,
    treeshake: true,
  },
  {
    entry: { browser: 'src/browser.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
    splitting: false,
    treeshake: true,
    external: ['fflate'],
  },
]);
