/**
 * AceChromExt stands alone.
 *
 * Deckhand was first built inside a separate repository that is being
 * retired. Everything worth keeping was migrated into deckhand/ and shared/,
 * and this test makes sure nothing in the software, its build, or its
 * operating instructions reaches back: no import outside this repository, no
 * dependency on that repository's runtime (a hosted worker with a model API
 * behind it), and no mention of it anywhere but one historical note in
 * docs/DECKHAND.md.
 *
 * The operator dashboard (web/) is hosted, and that is the one place a
 * hosting provider may be named: it is a static page, with no worker script
 * and no service behind it, checked by tests/webInvariants.test.ts. The
 * extensions, Deckhand, the filing package and the companion must still not
 * know a hosting provider exists.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-inttra', 'dist-companion', 'dist-web', 'coverage', '.vitest']);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

const posix = (path: string): string => path.split(sep).join('/');
const files = walk(ROOT).map((path) => ({ path: posix(relative(ROOT, path)), absolute: path }));
const textFiles = files.filter(({ path }) => /\.(ts|mjs|js|json|html|css|yml|yaml|md|txt|ps1)$/.test(path) && !path.endsWith('package-lock.json'));
const codeFiles = textFiles.filter(({ path }) => /\.(ts|mjs|js|json|html|css|yml|yaml|ps1)$/.test(path));

/** The one place the origin may be mentioned, as history. */
const HISTORY_NOTE = 'docs/DECKHAND.md';
const RETIRED = /\byigal\b|effimorremitrix\/yigal|tidelane|worker\/deckhand|deckhand-brief|@anthropic-ai\/sdk|ANTHROPIC_API_KEY/i;

/** A hosting provider or a hosted model API. Allowed only where the dashboard is defined, built, tested and documented. */
const HOSTED_RUNTIME = /wrangler|cloudflare|workers\.dev|pages\.dev|anthropic|openai/i;
const HOSTED_RUNTIME_ALLOWED = [/^web\//, /^scripts\/build-web\.mjs$/, /^tests\/web\//, /^tests\/webInvariants\.test\.ts$/, /^tests\/independence\.test\.ts$/, /^\.github\/workflows\//, /^docs\/.*\.md$/, /^README\.md$/, /^CLAUDE\.md$/, /^package\.json$/];

describe('no dependency on the retired repository', () => {
  it('names it nowhere in code, configuration, fixtures or workflows', () => {
    const offenders = codeFiles.filter(({ absolute, path }) => path !== 'tests/independence.test.ts' && RETIRED.test(readFileSync(absolute, 'utf8'))).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('mentions it in documentation only as the one historical note', () => {
    const offenders = textFiles
      .filter(({ path }) => path.endsWith('.md') && path !== HISTORY_NOTE)
      .filter(({ absolute }) => RETIRED.test(readFileSync(absolute, 'utf8')))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    expect(existsSync(join(ROOT, HISTORY_NOTE))).toBe(true);
  });

  it('keeps the local programs free of any hosting provider', () => {
    // The extensions, Deckhand, the filing package, the companion, their
    // builds and their tests: none may name the dashboard's host or a hosted
    // model API. Only the dashboard's own files, its build, its tests, the
    // workflows and the documentation may.
    const offenders = textFiles
      .filter(({ path }) => !HOSTED_RUNTIME_ALLOWED.some((pattern) => pattern.test(path)))
      .filter(({ absolute }) => HOSTED_RUNTIME.test(readFileSync(absolute, 'utf8')))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependency that would need a hosted service', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const name of names) {
      expect(name, name).not.toMatch(/anthropic|openai|wrangler|cloudflare|react|hono|itty/i);
    }
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['xlsx']);
  });

  it('resolves every relative import inside this repository', () => {
    const problems: string[] = [];
    for (const { path, absolute } of files.filter(({ path }) => /\.(ts|mjs)$/.test(path))) {
      const code = readFileSync(absolute, 'utf8');
      for (const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        const specifier = match[1] ?? match[2] ?? '';
        const target = resolve(dirname(absolute), specifier);
        if (!target.startsWith(ROOT + sep)) problems.push(`${path} -> ${specifier}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps Deckhand and the filing package free of any browser, portal, or network dependency', () => {
    for (const folder of ['deckhand/src', 'shared/src']) {
      for (const { path, absolute } of files.filter(({ path }) => path.startsWith(`${folder}/`) && path.endsWith('.ts'))) {
        const code = readFileSync(absolute, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code, path).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
        expect(code, path).not.toMatch(/\bchrome\./);
        expect(code, path).not.toMatch(/\bdocument\.[a-zA-Z]|\bwindow\.[a-zA-Z]/);
        expect(code, path).not.toMatch(/from\s+['"][^'"]*(\/content\/|inttra-extension|companion|\/ui\/)/);
        expect(code, path).not.toMatch(/\beval\s*\(|new\s+Function/);
      }
    }
  });

  it('ships the fixtures Deckhand is tested against inside this repository, sanitized', () => {
    const fixtures = files.filter(({ path }) => path.startsWith('tests/fixtures/deckhand/'));
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    for (const { path, absolute } of fixtures) {
      const text = readFileSync(absolute, 'utf8');
      expect(text, path).not.toMatch(/galco|tzfira/i);
      expect(text, path).toMatch(/\.example\b|^Subject:/m);
    }
  });
});
