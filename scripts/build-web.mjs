/**
 * Builds the operator dashboard into dist-web/.
 *
 *   npm run build:web          one-off build
 *   npm run build:web:watch    rebuild on change
 *   npm run dev:web            rebuild on change and serve on 127.0.0.1
 *
 * One HTML page, one stylesheet pair (the panels' ui.css, copied, plus the
 * dashboard's own), one script. esbuild bundles every dependency, SheetJS
 * included, so the page loads nothing from anywhere else - the CSP in
 * index.html and web/_headers would refuse it anyway.
 *
 * The output is a plain static folder. `npm run check:bundle:web` runs the
 * same supply-chain check over it as over the two extensions.
 */

import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = join(root, 'web');
const dist = join(root, 'dist-web');
const watch = process.argv.includes('--watch') || process.argv.includes('--serve');
const serve = process.argv.includes('--serve');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function copyStatic() {
  mkdirSync(join(dist, 'styles'), { recursive: true });
  cpSync(join(source, 'index.html'), join(dist, 'index.html'));
  cpSync(join(source, '_headers'), join(dist, '_headers'));
  cpSync(join(root, 'extension', 'styles', 'ui.css'), join(dist, 'styles', 'ui.css'));
  cpSync(join(source, 'styles', 'dashboard.css'), join(dist, 'styles', 'dashboard.css'));
  writeFileSync(join(dist, '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found. The dashboard is at <a href="/">/</a>.</p>\n');
}

const options = {
  entryPoints: { dashboard: join(source, 'src', 'main.ts') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'linked',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
    __DASHBOARD_VERSION__: JSON.stringify(pkg.version),
    __DASHBOARD_BUILT_AT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
};

async function run() {
  rmSync(dist, { recursive: true, force: true });
  copyStatic();

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    if (serve) {
      const server = await ctx.serve({ servedir: dist, host: '127.0.0.1', port: Number(process.env.PORT ?? 8788) });
      console.log(`\nOperator dashboard: http://${server.host}:${server.port}/  (this machine only; Ctrl+C to stop)`);
    } else {
      console.log('watching for changes...');
    }
    return;
  }

  await build(options);
  const size = statSync(join(dist, 'dashboard.js')).size;
  console.log(`  dashboard.js  ${(size / 1024).toFixed(1)} kB`);
  console.log(`\nOperator dashboard ready: ${dist}`);
  console.log('Serve it from any static host, or: npx wrangler deploy --config web/wrangler.jsonc');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
