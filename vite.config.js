import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include every published asset so updates never depend on a manual SW bump.
function versionServiceWorker() {
  return {
    name: 'version-service-worker',
    async closeBundle() {
      const output = resolve('docs');
      const worker = await readFile(resolve(output, 'sw.js'), 'utf8');
      const hash = createHash('sha256').update(worker);
      const files = (await readdir(output, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name !== 'sw.js')
        .map((entry) => resolve(entry.parentPath, entry.name)).sort();
      for (const file of files) {
        hash.update(file.slice(output.length)).update(await readFile(file));
      }
      await writeFile(resolve(output, 'sw.js'), worker.replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16)));
    },
    apply: 'build',
  };
}

export default defineConfig({
  // Relative URLs support both root sites and GitHub Pages project sites.
  base: './',
  plugins: [versionServiceWorker()],
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
