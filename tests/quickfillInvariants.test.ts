/**
 * Quickfill Helper safety invariants.
 *
 * Quickfill drops the preview, the data quality checks, the Deckhand review,
 * the conflict screen and the readiness gate on purpose: the operator checks
 * the form. What it does NOT drop is everything in docs/SECURITY.md, and this
 * file is where that distinction is written down and enforced.
 *
 * So there is deliberately no test here that a value is shown before it is
 * written, and no test that filling is gated on a review. There is every test
 * that the extension cannot execute code it was given, cannot reach the
 * network, cannot touch a credential, and cannot press a button in either
 * portal.
 *
 * tests/invariants.test.ts walks src/ and companion/, and
 * tests/inttraInvariants.test.ts walks inttra-extension/; neither one would
 * have looked at a new top-level directory, so a third extension without this
 * file would have shipped with no promises at all.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'quickfill-extension');
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

describe('Quickfill: the source is covered', () => {
  it('walks every TypeScript file in the extension', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.map(({ path }) => path)).toContain('src/content/quickfillContent.ts');
    expect(sources.map(({ path }) => path)).toContain('src/paste.ts');
  });
});

describe('Quickfill: no dynamic code, no network', () => {
  it('never calls eval, new Function, or a string timer', () => {
    expect(offenders(/\beval\s*\(/)).toEqual([]);
    expect(offenders(/new\s+Function\s*\(/)).toEqual([]);
    expect(offenders(/\bFunction\s*\(\s*['"`]/)).toEqual([]);
    expect(offenders(/set(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([]);
  });

  it('never imports dynamically', () => {
    expect(offenders(/\bimport\s*\(/)).toEqual([]);
  });

  it('never calls fetch, XMLHttpRequest, WebSocket, EventSource, or sendBeacon', () => {
    expect(offenders(/\bfetch\s*\(/)).toEqual([]);
    expect(offenders(/XMLHttpRequest|new\s+WebSocket|new\s+EventSource|sendBeacon/)).toEqual([]);
  });

  it('names no http(s) URL at all', () => {
    const urls = sources.flatMap(({ code }) => code.match(/https?:\/\/[^\s'"`)]+/g) ?? []);
    expect(urls).toEqual([]);
  });
});

describe('Quickfill: attended, never presses anything', () => {
  it('never clicks, submits, navigates, or synthesises a mouse event in the content layer', () => {
    const content = sources.filter(({ path }) => path.includes('/content/'));
    expect(content.length).toBeGreaterThan(0);
    for (const { path, code } of content) {
      expect(code, path).not.toMatch(/\.click\s*\(/);
      expect(code, path).not.toMatch(/\.submit\s*\(/);
      expect(code, path).not.toMatch(/requestSubmit/);
      expect(code, path).not.toMatch(/location\s*\.\s*(href|assign|replace)\s*=/);
      expect(code, path).not.toMatch(/window\.open/);
      expect(code, path).not.toMatch(/MouseEvent|PointerEvent|KeyboardEvent/);
    }
  });

  it('inherits both automation policies rather than declaring a third', () => {
    // Quickfill has no automationPolicy.ts of its own: it fills through the two
    // extensions' own fillers, and those are the files that carry the switches.
    // A policy file here would be a second place to turn Save on.
    expect(sources.map(({ path }) => path)).not.toContain('src/content/automationPolicy.ts');
  });

  it('keeps both portals attended', async () => {
    const { AUTOMATION_POLICY } = await import('../src/content/automationPolicy.js');
    const { INTTRA_AUTOMATION_POLICY } = await import('../inttra-extension/src/content/automationPolicy.js');
    expect(AUTOMATION_POLICY.clickSaveLine).toBe(false);
    expect(AUTOMATION_POLICY.clickAddLine).toBe(false);
    expect(AUTOMATION_POLICY.submitFiling).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.clickAddRow).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.clickContinue).toBe(false);
    expect(INTTRA_AUTOMATION_POLICY.submitShippingInstruction).toBe(false);
  });
});

describe('Quickfill: writes only through the two field writers', () => {
  it('never assigns .value or .textContent in the content layer', () => {
    for (const { path, code } of sources.filter(({ path }) => path.includes('/content/'))) {
      expect(code, path).not.toMatch(/\.value\s*=\s*[^=]/);
      expect(code, path).not.toMatch(/\.textContent\s*=\s*[^=]/);
    }
  });

  it('does not import either field writer directly', () => {
    // Every write goes through fillFields / fillInttraFields / fillContainerGrid,
    // which own the read-back check. A direct writer import here would be a
    // second write path with no verification behind it.
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*fieldWriter\.js['"]/);
    }
  });
});

describe('Quickfill: no credential, no persistence', () => {
  it('handles no credential of any kind', () => {
    expect(offenders(/document\.cookie/)).toEqual([]);
    expect(offenders(/\bpassword\b/i)).toEqual([]);
    expect(offenders(/\bcredential/i)).toEqual([]);
    expect(offenders(/type\s*=\s*['"]password['"]/)).toEqual([]);
  });

  it('never touches browser storage outside chrome.storage.session', () => {
    expect(offenders(/localStorage|sessionStorage|indexedDB|caches\./)).toEqual([]);
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
});

describe('Quickfill: what it may and may not import', () => {
  it('reuses the mappings and fillers rather than copying them', () => {
    const all = sources.map(({ code }) => code).join('\n');
    expect(all).toMatch(/from\s+['"][^'"]*src\/content\/filler\.js['"]/);
    expect(all).toMatch(/from\s+['"][^'"]*inttra-extension\/src\/content\/filler\.js['"]/);
    expect(all).toMatch(/from\s+['"][^'"]*deckhand\/src\/extractor\.js['"]/);
    expect(all).toMatch(/from\s+['"][^'"]*shared\/src\/builder\.js['"]/);
  });

  it('declares no selector table of its own', () => {
    // The whole point of a third extension sharing the code is that a selector
    // ACE changes is fixed once. A mappings/ or selectors/ folder here would
    // undo that the first time someone pasted a candidate into it.
    expect(walk(SRC, '.ts').some((path) => /\/(mappings|selectors)\//.test(posix(path)))).toBe(false);
  });

  it('imports nothing from the companion or the dashboard', () => {
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*companion/);
      expect(code, path).not.toMatch(/from\s+['"][^'"]*\bweb\//);
      expect(code, path).not.toMatch(/from\s+['"]node:/);
    }
  });
});

describe('Quickfill manifest', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Record<string, unknown>;

  it('is Manifest V3, named Quickfill Helper, asking for storage, scripting and sidePanel and nothing else', () => {
    expect(manifest['manifest_version']).toBe(3);
    expect(manifest['name']).toBe('Quickfill Helper');
    // `scripting` was added on 2026-09-21, deliberately, and this is where that
    // decision is written down. Chrome injects a content script when a page
    // LOADS, so every portal tab that was already open when the helper was
    // loaded or rebuilt is orphaned: the manifest still matches it, and it is
    // running nothing. On the live create page that emptied the popup in front
    // of the grid the operator was filling. `scripting` lets the panel start
    // the script in the tab instead of asking for a page reload that closes
    // the Copy Container Details modal.
    //
    // It widens nothing the operator can see: `host_permissions` already grant
    // the five portal hosts, and Chrome refuses an injection anywhere else. The
    // test below pins what it may be used for - this extension's own bundled
    // file, never a function and never the page's own world - which is the part
    // that would otherwise drift into arbitrary code injection.
    //
    // `sidePanel` came later, on 2026-09-22, and reverses what this file said
    // on the day the side panel was built: that Quickfill would NOT have one,
    // because a side panel costs the portal width that one paste box does not
    // need, and a pop-out window could sit on a second screen instead. The
    // operator asked for it anyway, having used both. The argument that
    // decided it is not about width: three helpers behaving three ways is one
    // thing more to remember than a forwarder in a hurry has room for, and the
    // pop-out button only ever existed to work around a popup Quickfill no
    // longer has. Like the other two, it buys a SURFACE and nothing else - no
    // host, no network, no tab reading, no injection - and it REPLACED the
    // action popup rather than adding to it.
    expect(manifest['permissions']).toEqual(['storage', 'scripting', 'sidePanel']);
    expect(manifest['action']).not.toHaveProperty('default_popup');
    expect(manifest['side_panel']).toEqual({ default_path: 'sidepanel.html' });
    expect(manifest['optional_permissions']).toBeUndefined();
    expect(manifest['optional_host_permissions']).toBeUndefined();
  });

  it('uses scripting only to start its own content script, never to run code it composed', () => {
    const users = sources.filter(({ code }) => /chrome\.scripting/.test(code));
    // One caller, so there is one place to read. A second would be a second
    // set of rules about what may be injected.
    expect(users.map(({ path }) => path)).toEqual(['src/ui/sidePanel.ts']);
    for (const { path, code } of users) {
      // The bundled content script by name: not a path from a message, not a
      // file named anywhere else, and nothing the operator pasted.
      expect(code, path).toMatch(/files:\s*\[\s*'quickfillContent\.js'\s*\]/);
      // `func` and `args` run a function in the page's process, and MAIN puts
      // it in the page's own world beside the portal's scripts. Either would
      // make this extension a code-injection tool on a customs filing portal.
      expect(code, path).not.toMatch(/\bfunc\s*:/);
      expect(code, path).not.toMatch(/\bargs\s*:/);
      expect(code, path).not.toMatch(/world\s*:/);
      // Nothing persistent and no stylesheet: a registered script would outlive
      // the popup, and a stylesheet in the page is what the content layer is
      // forbidden to add (tests/invariants.test.ts).
      expect(code, path).not.toMatch(/registerContentScripts|updateContentScripts|insertCSS|removeCSS/);
      // Only ever the tab the popup is open over.
      expect(code, path).not.toMatch(/allFrames:\s*false/);
      expect(code, path).toMatch(/target:\s*\{\s*tabId/);
    }
  });

  it('registers its content listener once, however many times the script is started', () => {
    // The popup starts the script in a tab that has none, and a frame that
    // already had it would otherwise answer every message twice - which Chrome
    // reports as "Could not send response more than once" and which would make
    // two frames' answers race.
    const content = readFileSync(join(SRC, 'content', 'quickfillContent.ts'), 'utf8');
    expect(content).toMatch(/if\s*\(!\s*frame\.__quickfillListening\s*\)/);
    expect(content).toMatch(/frame\.__quickfillListening\s*=\s*true/);
    expect((content.match(/onMessage\.addListener/g) ?? []).length).toBe(1);
  });

  it('names exactly the two portals’ hosts and never <all_urls>', () => {
    const hosts = manifest['host_permissions'] as string[];
    expect(hosts).toEqual([
      'https://ace.cbp.dhs.gov/*',
      'https://aesdirect.cbp.dhs.gov/*',
      'https://*.cbp.dhs.gov/*',
      'https://*.inttra.com/*',
      'https://*.e2open.com/*',
    ]);
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    for (const script of manifest['content_scripts'] as Array<{ matches: string[] }>) expect(script.matches).toEqual(hosts);
  });

  it('has a CSP with no unsafe-eval and no outbound connections, and no web_accessible_resources', () => {
    const csp = (manifest['content_security_policy'] as { extension_pages: string }).extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(manifest['web_accessible_resources']).toBeUndefined();
  });

  it('leaves the other two manifests single-portal', () => {
    // The combined host list is the reason Quickfill is a separate extension.
    // If it ever leaks into one of the others, that extension has silently
    // gained the right to read the other portal.
    const ace = readFileSync(join(__dirname, '..', 'extension', 'manifest.json'), 'utf8');
    const inttra = readFileSync(join(__dirname, '..', 'inttra-extension', 'manifest.json'), 'utf8');
    expect(ace).not.toContain('inttra.com');
    expect(ace).not.toContain('e2open.com');
    expect(inttra).not.toContain('cbp.dhs.gov');
  });
});
