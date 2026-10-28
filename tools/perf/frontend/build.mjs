import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = require(process.env.PERF_ESBUILD_MODULE || 'esbuild');
await mkdir('data/perf-frontend', { recursive: true });
await build({
  entryPoints: ['tools/perf/frontend/app.tsx'], outfile: 'data/perf-frontend/app.js',
  bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-actions-only', setup(b) {
    b.onResolve({ filter: /^@\/lib\/actions\/(pool|batches)$/ }, () => ({ path: path.resolve('tools/perf/frontend/action-fixture.ts') }));
  } }],
});
console.log('Built local UI bundle. Application source unchanged.');
