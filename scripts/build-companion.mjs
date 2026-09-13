/**
 * Builds the QuickBooks companion into dist-companion/.
 *
 *   npm run build:companion
 *   node dist-companion/ace-export.mjs --help
 *
 * Deliberately separate from scripts/build.mjs and from dist/: the extension
 * bundle is checked by scripts/check-bundle.mjs for network and dynamic-code
 * APIs, and the companion legitimately uses node:child_process and node:http
 * (to reach the local QuickBooks and to serve its own window on 127.0.0.1).
 * Mixing the two outputs would either weaken that check or fail it.
 *
 * One file, ESM, everything bundled: the companion installs by copying a
 * folder onto the QuickBooks PC, with no npm install at the other end.
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist-companion');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'companion', 'src', 'main.ts')],
  outfile: join(out, 'ace-export.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  minify: false,
  sourcemap: false,
  legalComments: 'linked',
  // SheetJS still reaches for `require('stream')` on the Node path, which an
  // ESM bundle does not provide. createRequire gives it a real one.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __aceCreateRequire } from 'node:module';",
      'const require = __aceCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});

// The COM bridge is looked up next to the bundle at runtime.
cpSync(join(root, 'companion', 'powershell', 'QbxmlRequest.ps1'), join(out, 'QbxmlRequest.ps1'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(
  join(out, 'README.txt'),
  [
    `ACE Export Helper ${pkg.version} - QuickBooks Desktop companion`,
    '',
    'Copy this whole folder onto the Windows PC that runs QuickBooks Desktop,',
    'then from a command prompt in this folder:',
    '',
    '    node ace-export.mjs --help',
    '    node ace-export.mjs probe',
    '    node ace-export.mjs gui',
    '',
    'Requires Node.js 20 or newer and the QuickBooks Desktop SDK.',
    'Full instructions: docs/QUICKBOOKS-INTEGRATION.md in the repository.',
    '',
    'Nothing here contacts the internet. Invoice data stays on this machine.',
    '',
  ].join('\n'),
);

const size = statSync(join(out, 'ace-export.mjs')).size;
console.log(`  ace-export.mjs  ${(size / 1024).toFixed(1)} kB`);
console.log(`\nCompanion ready: ${out}`);
console.log('Run it with: node dist-companion/ace-export.mjs --help');
