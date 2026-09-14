/**
 * Builds the INTTRA Helper into dist-inttra/.
 *
 *   npm run build:inttra
 *
 * A second, separate unpacked extension. Deliberately not merged into dist/:
 * the ACE Helper keeps its CBP-only host permissions and the INTTRA Helper
 * keeps its INTTRA/e2open-only ones, and each bundle is checked on its own by
 * scripts/check-bundle.mjs with its own host allowlist.
 *
 * The shared stylesheet is copied from extension/styles/ui.css so the two
 * panels look alike without a second copy in the repository.
 */

import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = join(root, 'inttra-extension');
const dist = join(root, 'dist-inttra');
const watch = process.argv.includes('--watch');

const CLASSIC_ENTRIES = {
  inttraContent: 'inttra-extension/src/content/inttraContent.ts',
  popup: 'inttra-extension/src/ui/popup.ts',
  panel: 'inttra-extension/src/ui/panel.ts',
};

const MODULE_ENTRIES = {
  serviceWorker: 'inttra-extension/src/background/serviceWorker.ts',
};

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const name of ['manifest.json', 'panel.html', 'popup.html']) cpSync(join(source, name), join(dist, name));
  cpSync(join(source, 'icons'), join(dist, 'icons'), { recursive: true });
  mkdirSync(join(dist, 'styles'), { recursive: true });
  cpSync(join(root, 'extension', 'styles', 'ui.css'), join(dist, 'styles', 'ui.css'));
  cpSync(join(source, 'styles', 'inttra.css'), join(dist, 'styles', 'inttra.css'));

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
  console.log(`\nUnpacked INTTRA Helper ready: ${dist}`);
  console.log('Load it with chrome://extensions -> Developer mode -> Load unpacked.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
