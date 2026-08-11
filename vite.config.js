import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs support both root sites and GitHub Pages project sites.
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
