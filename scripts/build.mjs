/**
 * Builds the unpacked extension into dist/.
 *
 * esbuild bundles every dependency (including SheetJS) into the output, so the
 * extension ships no remote code and needs no network access at runtime.
 *
 *   npm run build          one-off build
 *   npm run build:watch    rebuild on change
 *
 * Output formats matter here:
 *   - the content script and the popup/panel scripts are IIFEs, because MV3
 *     content scripts and plain <script src> tags are not ES modules;
 *   - the service worker is ESM, which is what manifest.json declares.
 */

import { build, context } from 'esbuild';
import { buildVersionName } from './buildStamp.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

const CLASSIC_ENTRIES = {
  aceContent: 'src/content/aceContent.ts',
  popup: 'src/ui/popup.ts',
  panel: 'src/ui/panel.ts',
};

const MODULE_ENTRIES = {
  serviceWorker: 'src/background/serviceWorker.ts',
};

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, 'extension'), dist, { recursive: true });

  const template = join(root, 'templates', 'ACE_Import_Template.xlsx');
  if (existsSync(template)) {
    mkdirSync(join(dist, 'templates'), { recursive: true });
    cpSync(template, join(dist, 'templates', 'ACE_Import_Template.xlsx'));
  } else {
    console.warn('! templates/ACE_Import_Template.xlsx is missing. Run: npm run template');
  }

  // Keep the manifest version in step with package.json.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  // ...and stamp the build (git commit + time) so a loaded build can be told apart.
  manifest.version_name = buildVersionName(pkg.version, root);
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
    // SheetJS probes for a Node environment; this keeps the browser paths.
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

  for (const config of configs) {
    await build(config);
  }

  for (const name of [...Object.keys(CLASSIC_ENTRIES), ...Object.keys(MODULE_ENTRIES)]) {
    const size = statSync(join(dist, `${name}.js`)).size;
    console.log(`  ${name}.js  ${(size / 1024).toFixed(1)} kB`);
  }
  console.log(`\nUnpacked extension ready: ${dist}`);
  console.log('Load it with chrome://extensions -> Developer mode -> Load unpacked.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
