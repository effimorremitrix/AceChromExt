/**
 * Builds the Quickfill Helper into dist-quickfill/.
 *
 *   npm run build:quickfill
 *   npm run build:quickfill:playground   (--playground: dist-quickfill-playground/)
 *
 * The playground build is the same bundles under a manifest that matches
 * pages opened from disk and from localhost only, never a portal, with the
 * four mock AESDirect steps and the example workbook written beside it
 * (scripts/playground.mjs). It is how an operator practises a fill without
 * a portal, and it can never be mistaken for the real build: a different
 * name on the card, no host permission at all.
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
import { buildVersionName } from './buildStamp.mjs';
import { PLAYGROUND_MATCHES, writePlayground } from './playground.mjs';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = join(root, 'quickfill-extension');
const watch = process.argv.includes('--watch');
const playground = process.argv.includes('--playground');
const dist = join(root, playground ? 'dist-quickfill-playground' : 'dist-quickfill');

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
  // ...and stamp the build (git commit + time) so a loaded build can be told apart.
  manifest.version_name = buildVersionName(pkg.version, root);
  if (playground) {
    manifest.name = 'Quickfill Helper (playground)';
    manifest.action.default_title = 'Quickfill Helper (playground)';
    manifest.description = 'Practice build: runs only on pages opened from disk or from localhost, never on ACE or INTTRA. Paste the example rows and fill the four mock steps in playground/.';
    delete manifest.host_permissions;
    for (const script of manifest.content_scripts) script.matches = [...PLAYGROUND_MATCHES];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (playground) {
    const files = writePlayground(join(dist, 'playground'), { fixtures: join(root, 'tests', 'fixtures'), stamp: manifest.version_name });
    console.log(`  playground/: ${files.join(', ')}`);
  }
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
  if (playground) {
    console.log(`\nQuickfill playground ready: ${dist}`);
    console.log('Load it with chrome://extensions -> Developer mode -> Load unpacked, allow access to file URLs on its card, then open playground/step1-shipment.html.');
    return;
  }
  console.log(`\nUnpacked Quickfill Helper ready: ${dist}`);
  console.log('Load it with chrome://extensions -> Developer mode -> Load unpacked.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
