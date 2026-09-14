/**
 * INTTRA Helper safety invariants, asserted against the source and the
 * manifest, in the same spirit as tests/invariants.test.ts for the ACE Helper.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'inttra-extension');
const SRC = join(ROOT, 'src');

const posix = (path: string): string => path.split(sep).join('/');

function walk(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, extension));
    else if (path.endsWith(extension)) found.push(posix(path));
  }
  return found;
}

const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sources = walk(SRC, '.ts').map((path) => ({ path: path.replace(`${posix(ROOT)}/`, ''), code: stripComments(readFileSync(path, 'utf8')) }));
const offenders = (pattern: RegExp): string[] => sources.filter(({ code }) => pattern.test(code)).map(({ path }) => path);

describe('INTTRA Helper: no dynamic code, no network', () => {
  it('never calls eval, new Function, or a string timer', () => {
    expect(offenders(/\beval\s*\(/)).toEqual([]);
    expect(offenders(/new\s+Function\s*\(/)).toEqual([]);
    expect(offenders(/set(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([]);
  });

  it('never calls fetch, XMLHttpRequest, WebSocket, or sendBeacon', () => {
    expect(offenders(/\bfetch\s*\(/)).toEqual([]);
    expect(offenders(/XMLHttpRequest|new\s+WebSocket|sendBeacon/)).toEqual([]);
  });

  it('names no http(s) URL but its own INTTRA and e2open match patterns', () => {
    const urls = sources.flatMap(({ code }) => code.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter((url) => !/^https:\/\/\*\.(inttra\.com|e2open\.com)\/\*$/.test(url));
    expect(urls).toEqual([]);
  });
});

describe('INTTRA Helper: attended, never submits, never logs in', () => {
  it('keeps every automation switch off and frozen', async () => {
    const { INTTRA_AUTOMATION_POLICY } = await import('../inttra-extension/src/content/automationPolicy.js');
    expect(INTTRA_AUTOMATION_POLICY.clickAddRow).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.clickContinue).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.submitShippingInstruction).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.performLogin).toBe(false);
    expect(Object.isFrozen(INTTRA_AUTOMATION_POLICY)).toBe(true);
    const settings = readFileSync(join(SRC, 'core', 'settings.ts'), 'utf8');
    expect(settings).not.toMatch(/addRow|continue|submit|login|headless/i);
  });

  it('never clicks, submits, navigates, or dispatches mouse events in the content layer', () => {
    for (const { path, code } of sources.filter(({ path }) => path.includes('/content/'))) {
      expect(code, path).not.toMatch(/\.click\s*\(/);
      expect(code, path).not.toMatch(/\.submit\s*\(/);
      expect(code, path).not.toMatch(/requestSubmit/);
      expect(code, path).not.toMatch(/location\s*\.\s*(href|assign|replace)\s*=/);
      expect(code, path).not.toMatch(/window\.open/);
      expect(code, path).not.toMatch(/MouseEvent|PointerEvent/);
    }
  });

  it('writes to INTTRA only through setInttraFieldValue', () => {
    for (const { path, code } of sources.filter(({ path }) => path.includes('/content/') && !path.endsWith('fieldWriter.ts'))) {
      expect(code, path).not.toMatch(/\.value\s*=\s*[^=]/);
      expect(code, path).not.toMatch(/\.textContent\s*=\s*[^=]/);
    }
  });

  it('handles no credential of any kind', () => {
    expect(offenders(/document\.cookie/)).toEqual([]);
    expect(offenders(/\bpassword\b/i)).toEqual([]);
    expect(offenders(/\bcredential/i)).toEqual([]);
    expect(offenders(/localStorage|sessionStorage/)).toEqual([]);
    expect(offenders(/type\s*=\s*['"]password['"]/)).toEqual([]);
  });

  it('keeps the package in session storage, never local or sync', () => {
    const store = readFileSync(join(SRC, 'core', 'store.ts'), 'utf8');
    expect(store).toMatch(/chrome\.storage\.session/);
    expect(store).not.toMatch(/storage\.local|storage\.sync/);
  });

  it('assigns innerHTML only from string literals', () => {
    for (const { path, code } of sources) {
      for (const assignment of code.match(/innerHTML\s*=\s*[^;]+/g) ?? []) {
        expect(assignment, path).toMatch(/innerHTML\s*=\s*'[^'${}+]*'/);
      }
    }
  });

  it('does not import the ACE content script, the ACE filler, or the companion', () => {
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*\/content\/(aceContent|filler|automationPolicy)\.js['"]/);
      expect(code, path).not.toMatch(/from\s+['"][^'"]*companion/);
    }
  });
});

describe('INTTRA Helper manifest', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Record<string, unknown>;

  it('is Manifest V3, named INTTRA Helper, with only the storage permission', () => {
    expect(manifest['manifest_version']).toBe(3);
    expect(manifest['name']).toBe('INTTRA Helper');
    expect(manifest['permissions']).toEqual(['storage']);
  });

  it('is restricted to INTTRA and e2open hosts, never <all_urls>, never a CBP host', () => {
    const hosts = manifest['host_permissions'] as string[];
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host).toMatch(/^https:\/\/\*\.(inttra\.com|e2open\.com)\/\*$/);
    }
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(JSON.stringify(manifest)).not.toContain('cbp.dhs.gov');
    for (const script of manifest['content_scripts'] as Array<{ matches: string[] }>) expect(script.matches).toEqual(hosts);
  });

  it('has a CSP with no unsafe-eval and no outbound connections, and no web_accessible_resources', () => {
    const csp = (manifest['content_security_policy'] as { extension_pages: string }).extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(manifest['web_accessible_resources']).toBeUndefined();
  });

  it('keeps the tab URL patterns in step with the manifest', () => {
    const tabs = readFileSync(join(SRC, 'ui', 'tabs.ts'), 'utf8');
    for (const host of manifest['host_permissions'] as string[]) expect(tabs, host).toContain(host);
  });

  it('does not touch the ACE Helper manifest', () => {
    const ace = JSON.parse(readFileSync(join(__dirname, '..', 'extension', 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(ace)).not.toMatch(/inttra|e2open/i);
    expect(ace['permissions']).toEqual(['storage']);
  });
});
