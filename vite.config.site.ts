import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Builds site/ as a standalone app for GitHub Pages.
 * Bundles extractly source + fflate inline so the playground
 * works without npm install.
 *
 * Usage: npx vite build --config vite.config.site.ts
 * Output: docs/
 */
export default defineConfig({
  root: 'site',
  base: '/extractly/',
  resolve: {
    alias: {
      'extractly/browser': resolve(__dirname, 'src/browser.ts'),
      'extractly/markdown': resolve(__dirname, 'src/markdown-entry.ts'),
    },
    modules: [resolve(__dirname, 'node_modules'), 'node_modules'],
  },
  build: {
    outDir: '../docs',
    emptyOutDir: true,
  },
});
