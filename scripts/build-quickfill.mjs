/**
 * Builds the Quickfill Helper into dist-quickfill/.
 *
 *   npm run build:quickfill
 *
 * A third, separate unpacked extension. It is deliberately not a mode inside
 * either of the other two: it is the only one of the three that asks for both
 * the CBP hosts and the INTTRA/e2open hosts at once, and keeping that combined
 * host list in its own manifest is precisely what stops the ACE Helper and the
 * INTTRA Helper from quietly acquiring each other's permissions. Each bundle is
 * checked on its own by scripts/check-bundle.mjs with its own host allowlist.
 *
 * The shared stylesheet is copied from extension/styles/ui.css so the three
 * surfaces look alike without a third copy in the repository.
 */

import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = join(root, 'quickfill-extension');
const dist = join(root, 'dist-quickfill');
const watch = process.argv.includes('--watch');

const CLASSIC_ENTRIES = {
  quickfillContent: 'quickfill-extension/src/content/quickfillContent.ts',
  popup: 'quickfill-extension/src/ui/popup.ts',
};

const MODULE_ENTRIES = {
  serviceWorker: 'quickfill-extension/src/background/serviceWorker.ts',
};

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const name of ['manifest.json', 'popup.html']) cpSync(join(source, name), join(dist, name));
  cpSync(join(source, 'icons'), join(dist, 'icons'), { recursive: true });
  mkdirSync(join(dist, 'styles'), { recursive: true });
  cpSync(join(root, 'extension', 'styles', 'ui.css'), join(dist, 'styles', 'ui.css'));
  cpSync(join(source, 'styles', 'quickfill.css'), join(dist, 'styles', 'quickfill.css'));

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function optionsFor(entries, format) {
  return {
    entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, join(root, file)])),
    outdir: dist,
    bundle: true,
    format,
    target: ['chrome114'],
    platform: 'browser',
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    legalComments: 'linked',
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  };
}

async function run() {
  rmSync(dist, { recursive: true, force: true });
  copyStatic();
  const configs = [optionsFor(CLASSIC_ENTRIES, 'iife'), optionsFor(MODULE_ENTRIES, 'esm')];
  if (watch) {
    for (const config of configs) {
      const ctx = await context(config);
      await ctx.watch();
    }
    console.log('watching for changes...');
    return;
  }
  for (const config of configs) await build(config);
  for (const name of [...Object.keys(CLASSIC_ENTRIES), ...Object.keys(MODULE_ENTRIES)]) {
    const size = statSync(join(dist, `${name}.js`)).size;
    console.log(`  ${name}.js  ${(size / 1024).toFixed(1)} kB`);
  }
  console.log(`\nUnpacked Quickfill Helper ready: ${dist}`);
  console.log('Load it with chrome://extensions -> Developer mode -> Load unpacked.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
