/**
 * Security and safety invariants, asserted against the source itself.
 *
 * These are the promises in README.md and docs/SECURITY.md. Asserting them
 * here means a future change cannot quietly break one: the test fails first.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const EXTENSION = join(__dirname, '..', 'extension');

function walk(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, extension));
    } else if (path.endsWith(extension)) {
      found.push(path);
    }
  }
  return found;
}

const sources = walk(SRC, '.ts').map((path) => ({ path, code: readFileSync(path, 'utf8') }));

/** Strip comments so a rule named in a doc comment is not mistaken for a use. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const stripped = sources.map(({ path, code }) => ({ path, code: stripComments(code) }));

function offenders(pattern: RegExp): string[] {
  return stripped.filter(({ code }) => pattern.test(code)).map(({ path }) => path.replace(`${SRC}/`, ''));
}

describe('no dynamic code execution', () => {
  it('never calls eval', () => {
    expect(offenders(/\beval\s*\(/)).toEqual([]);
  });

  it('never constructs functions from strings', () => {
    expect(offenders(/new\s+Function\s*\(/)).toEqual([]);
    expect(offenders(/\bFunction\s*\(\s*['"`]/)).toEqual([]);
  });

  it('never passes a string to setTimeout or setInterval', () => {
    expect(offenders(/set(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([]);
  });

  it('never uses the import() of a computed URL', () => {
    expect(offenders(/import\s*\(\s*(?!['"])/)).toEqual([]);
  });
});

describe('no network access', () => {
  it('never calls fetch, XMLHttpRequest, WebSocket, or sendBeacon', () => {
    expect(offenders(/\bfetch\s*\(/)).toEqual([]);
    expect(offenders(/XMLHttpRequest/)).toEqual([]);
    expect(offenders(/new\s+WebSocket/)).toEqual([]);
    expect(offenders(/sendBeacon/)).toEqual([]);
    expect(offenders(/navigator\.connection/)).toEqual([]);
  });

  it('contains no http(s) URL that is not a CBP host or a doc reference', () => {
    const urls = stripped
      .flatMap(({ code }) => code.match(/https?:\/\/[^\s'"`)]+/g) ?? [])
      .filter((url) => !url.includes('cbp.dhs.gov'));
    expect(urls).toEqual([]);
  });
});

describe('no ACE automation beyond typing', () => {
  it('never clicks, submits, or navigates an ACE page', () => {
    const content = stripped.filter(({ path }) => path.includes('/content/') || path.includes('/calculator/'));
    for (const { path, code } of content) {
      expect(code, path).not.toMatch(/\.click\s*\(/);
      expect(code, path).not.toMatch(/\.submit\s*\(/);
      expect(code, path).not.toMatch(/requestSubmit/);
      expect(code, path).not.toMatch(/location\s*\.\s*(href|assign|replace)\s*=/);
      expect(code, path).not.toMatch(/window\.open/);
    }
  });

  it('writes to ACE only through setAceFieldValue', () => {
    // Any other assignment to `.value` inside the content layer would bypass
    // the native setter and the input/change dispatch.
    const writers = stripped.filter(
      ({ path }) => path.includes('/content/') && !path.endsWith('fieldWriter.ts'),
    );
    for (const { path, code } of writers) {
      expect(code, path).not.toMatch(/\.value\s*=\s*[^=]/);
    }
  });
});

describe('no credential or filing-data handling', () => {
  it('never reads password, token, or cookie state', () => {
    expect(offenders(/document\.cookie/)).toEqual([]);
    expect(offenders(/type\s*=\s*['"]password['"]/)).toEqual([]);
    expect(offenders(/\bpassword\b/i)).toEqual([]);
    expect(offenders(/localStorage|sessionStorage/)).toEqual([]);
  });

  it('keeps imported shipment data in session storage, never storage.local', () => {
    const store = readFileSync(join(SRC, 'core', 'store.ts'), 'utf8');
    expect(store).toMatch(/chrome\.storage\.session/);
    expect(store).not.toMatch(/storage\.local/);
    expect(store).not.toMatch(/storage\.sync/);
  });
});

describe('no innerHTML of dynamic content', () => {
  it('assigns innerHTML only from string literals', () => {
    for (const { path, code } of stripped) {
      const assignments = code.match(/innerHTML\s*=\s*[^;]+/g) ?? [];
      for (const assignment of assignments) {
        // Literal-only: no template interpolation, no concatenation, no variable.
        expect(assignment, `${path}: ${assignment}`).toMatch(/innerHTML\s*=\s*'[^'${}+]*'/);
      }
    }
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync(join(EXTENSION, 'manifest.json'), 'utf8')) as Record<string, unknown>;

  it('is Manifest V3', () => {
    expect(manifest['manifest_version']).toBe(3);
    expect(manifest['name']).toBe('ACE Helper');
  });

  it('requests only the storage permission', () => {
    expect(manifest['permissions']).toEqual(['storage']);
  });

  it('is restricted to CBP hosts, in both host_permissions and content_scripts', () => {
    const hosts = manifest['host_permissions'] as string[];
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host).toMatch(/^https:\/\/[a-z*.]*cbp\.dhs\.gov\/\*$/);
    }

    const scripts = manifest['content_scripts'] as Array<{ matches: string[] }>;
    for (const script of scripts) {
      expect(script.matches).toEqual(hosts);
    }
  });

  it('has a CSP with no unsafe-eval and no outbound connections', () => {
    const csp = (manifest['content_security_policy'] as { extension_pages: string }).extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
  });

  it('declares no web_accessible_resources, so no page can read extension files', () => {
    expect(manifest['web_accessible_resources']).toBeUndefined();
  });

  it('keeps the tab URL patterns in src/ui/tabs.ts in step with the manifest', () => {
    const tabs = readFileSync(join(SRC, 'ui', 'tabs.ts'), 'utf8');
    for (const host of manifest['host_permissions'] as string[]) {
      expect(tabs, host).toContain(host);
    }
  });
});
