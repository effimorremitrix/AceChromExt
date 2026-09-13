/**
 * Supply-chain check on the SHIPPED bundles.
 *
 * tests/invariants.test.ts asserts the promises in docs/SECURITY.md against
 * our own source. This script asserts them against what actually ends up in
 * dist/, which also covers every bundled dependency - SheetJS included. A
 * dependency that introduced eval() or a network call would be caught here
 * even though no source file of ours changed.
 *
 *   npm run check:bundle     (after npm run build)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

if (!existsSync(dist)) {
  console.error('dist/ is missing. Run: npm run build');
  process.exit(1);
}

/** Patterns that must not appear anywhere in a shipped script. */
const FORBIDDEN = [
  { label: 'eval()', pattern: /\beval\s*\(/ },
  { label: 'new Function()', pattern: /new\s+Function\s*\(/ },
  { label: 'Function("...")', pattern: /\bFunction\s*\(\s*["'`]/ },
  { label: 'fetch()', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
  { label: 'WebSocket', pattern: /new\s+WebSocket/ },
  { label: 'sendBeacon', pattern: /sendBeacon/ },
  { label: 'EventSource', pattern: /new\s+EventSource/ },
  { label: 'importScripts', pattern: /importScripts\s*\(/ },
  { label: 'document.cookie', pattern: /document\.cookie/ },
  { label: 'localStorage', pattern: /\blocalStorage\b/ },
];

/**
 * Domains allowed to appear as a URL string, matched as a suffix so
 * subdomains and the `*.host` form of a Chrome match pattern are covered.
 *
 * The OOXML/Dublin Core ones are XML *namespace identifiers* that SheetJS
 * compares spreadsheet markup against. They are never dereferenced - the
 * forbidden list above proves there is no code in the bundle that could
 * fetch anything at all.
 *
 * cbp.dhs.gov appears as our own content-script match patterns.
 */
const ALLOWED_URL_DOMAINS = [
  'openxmlformats.org',
  'schemas.microsoft.com',
  'purl.org',
  'purl.oclc.org',
  'w3.org',
  'sheetjs.com',
  'cbp.dhs.gov',
];

function isAllowedHost(host) {
  // "*.cbp.dhs.gov" from a match pattern parses as that literal hostname.
  const bare = host.startsWith('*.') ? host.slice(2) : host;
  return ALLOWED_URL_DOMAINS.some((domain) => bare === domain || bare.endsWith(`.${domain}`));
}

const problems = [];
const files = readdirSync(dist).filter((name) => name.endsWith('.js'));

if (!files.length) {
  console.error('No .js files in dist/. Run: npm run build');
  process.exit(1);
}

for (const name of files) {
  const code = readFileSync(join(dist, name), 'utf8');

  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(code)) problems.push(`${name}: contains ${label}`);
  }

  const urls = code.match(/https?:\/\/[^\s'"`)\\]+/g) ?? [];
  for (const url of urls) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      problems.push(`${name}: unparseable URL ${url}`);
      continue;
    }
    if (!isAllowedHost(host)) {
      problems.push(`${name}: unexpected URL host ${host} (${url})`);
    }
  }
}

console.log(`Checked ${files.length} bundled script(s): ${files.join(', ')}`);

if (problems.length) {
  console.error('\nBundle check FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nSee docs/SECURITY.md. If a dependency legitimately needs one of these,');
  console.error('it must be justified there before the allowlist is widened.');
  process.exit(1);
}

console.log('Bundle check passed: no dynamic code execution, no network APIs, no unexpected URL hosts.');
