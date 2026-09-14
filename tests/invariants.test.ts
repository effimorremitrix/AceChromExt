/**
 * Security and safety invariants, asserted against the source itself.
 *
 * These are the promises in README.md and docs/SECURITY.md. Asserting them
 * here means a future change cannot quietly break one: the test fails first.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const EXTENSION = join(__dirname, '..', 'extension');
const COMPANION = join(__dirname, '..', 'companion');

/**
 * Forward slashes, on every platform.
 *
 * These tests match on path *fragments* - "/sources/", "src/ui/page.ts" - so
 * on Windows, where join() produces backslashes, an un-normalized path matches
 * nothing. That fails in the worst possible direction: a rule silently checks
 * an empty list and passes. Normalizing here is what keeps the invariants
 * honest on a Windows machine, which is where the QuickBooks companion runs.
 */
function posix(path: string): string {
  return path.split(sep).join('/');
}

const SRC_PREFIX = `${posix(SRC)}/`;
const COMPANION_PREFIX = `${posix(COMPANION)}/`;

function walk(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, extension));
    } else if (path.endsWith(extension)) {
      found.push(posix(path));
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
  return stripped.filter(({ code }) => pattern.test(code)).map(({ path }) => path.replace(SRC_PREFIX, ''));
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
  it('keeps Save Line and Add New Line disabled, with no setting that enables them', async () => {
    const { AUTOMATION_POLICY } = await import('../src/content/automationPolicy.js');
    expect(AUTOMATION_POLICY.clickSaveLine).toBe(false);
    expect(AUTOMATION_POLICY.clickAddLine).toBe(false);
    expect(AUTOMATION_POLICY.submitFiling).toBe(false);
    expect(Object.isFrozen(AUTOMATION_POLICY)).toBe(true);

    // No settings key may turn any of them on: the switch lives in one file,
    // and it is a source edit, not a preference.
    const settings = readFileSync(join(SRC, 'core', 'settings.ts'), 'utf8');
    expect(settings).not.toMatch(/saveLine|addLine|autoSubmit|certif/i);
  });

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

describe('the session log', () => {
  it('lives in session storage, never storage.local or a file', () => {
    const log = readFileSync(join(SRC, 'core', 'sessionLog.ts'), 'utf8');
    expect(log).toMatch(/chrome\.storage\.session/);
    expect(log).not.toMatch(/storage\.local/);
    expect(log).not.toMatch(/storage\.sync/);
  });

  it('screens entries for credential-shaped text before storing them', async () => {
    const { looksLikeSecret, makeEntry } = await import('../src/core/sessionLog.js');
    expect(looksLikeSecret('my password is hunter2')).toBe(true);
    expect(makeEntry('note', 'ACE password hunter2')?.message).not.toContain('hunter2');
  });

  it('is never sent anywhere: export writes a Blob, copy writes the clipboard', () => {
    const app = readFileSync(join(SRC, 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/URL\.createObjectURL/);
    expect(app).toMatch(/navigator\.clipboard/);
    expect(app).not.toMatch(/\bfetch\s*\(/);
  });
});

describe('the invoice data source seam', () => {
  it('keeps every source inside the extension, with no server of any kind', () => {
    const sourceFiles = stripped.filter(({ path }) => path.includes('/sources/'));
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const { path, code } of sourceFiles) {
      expect(code, path).not.toMatch(/\bfetch\s*\(/);
      expect(code, path).not.toMatch(/companion/);
      expect(code, path).not.toMatch(/XMLHttpRequest|WebSocket/);
    }
  });

  it('declares the web source unavailable rather than shipping a stub that pretends', () => {
    const web = readFileSync(join(SRC, 'sources', 'WebSource.ts'), 'utf8');
    expect(web).toMatch(/available = false/);
    expect(web).toMatch(/throw new SourceError/);
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

describe('the QuickBooks companion', () => {
  // The companion is a separate program, so the rules above (which are about
  // what may run inside Chrome) do not apply to it verbatim: it legitimately
  // spawns PowerShell and opens a loopback socket. These are its own promises,
  // from docs/SECURITY.md.
  const companionSources = walk(join(COMPANION, 'src'), '.ts').map((path) => ({
    path: path.replace(COMPANION_PREFIX, ''),
    code: stripComments(readFileSync(path, 'utf8')),
  }));

  function companionOffenders(pattern: RegExp): string[] {
    return companionSources.filter(({ code }) => pattern.test(code)).map(({ path }) => path);
  }

  /**
   * src/ui/page.ts holds the local window's own HTML and JavaScript as string
   * constants. Its `fetch` calls run in the operator's browser, against the
   * loopback server that served the page - they are not the Node process
   * reaching the network - so they are checked separately, below.
   */
  const nodeSources = companionSources.filter(({ path }) => path !== 'src/ui/page.ts');

  function nodeOffenders(pattern: RegExp): string[] {
    return nodeSources.filter(({ code }) => pattern.test(code)).map(({ path }) => path);
  }

  it('is not part of the extension bundle', () => {
    // Nothing under src/ may import it, or the extension would inherit its
    // process- and socket-level capabilities.
    for (const { path, code } of stripped) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*companion/);
    }
  });

  it('makes no outbound network request of any kind', () => {
    expect(nodeOffenders(/\bfetch\s*\(/)).toEqual([]);
    expect(nodeOffenders(/XMLHttpRequest/)).toEqual([]);
    expect(nodeOffenders(/new\s+WebSocket/)).toEqual([]);
    expect(nodeOffenders(/sendBeacon/)).toEqual([]);
    // node:http is present for the local window's *listener*; node:https, and
    // any client that could reach outward, must not be.
    expect(nodeOffenders(/from\s+['"]node:https['"]|require\(['"]https?['"]\)/)).toEqual([]);
    expect(nodeOffenders(/https?\.(request|get)\s*\(/)).toEqual([]);
  });

  it('lets the local page talk only to the page it came from', () => {
    const page = readFileSync(join(COMPANION, 'src', 'ui', 'page.ts'), 'utf8');
    // Every fetch target is a relative path, so it can only reach the loopback
    // server that served the page - and connect-src 'self' enforces that too.
    for (const call of page.match(/fetch\(([^,)]+)/g) ?? []) {
      expect(call, page).toMatch(/fetch\(path \+|fetch\('\/[^']*'/);
    }
    expect(page).not.toMatch(/https?:\/\//);
    expect(page).not.toMatch(/<script[^>]+src=["']http/);
  });

  it('names no host but this machine', () => {
    const urls = companionSources
      .flatMap(({ code }) => code.match(/https?:\/\/[^\s'"`)]+/g) ?? [])
      .filter((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(url));
    expect(urls).toEqual([]);
  });

  it('serves the local window on the loopback address only', () => {
    const server = readFileSync(join(COMPANION, 'src', 'ui', 'server.ts'), 'utf8');
    expect(server).toMatch(/server\.listen\([^)]*'127\.0\.0\.1'/);
    expect(server).not.toMatch(/'0\.0\.0\.0'/);
    // Every API route is behind a per-run token.
    expect(server).toMatch(/query\.get\('t'\) !== context\.token/);
  });

  it('only ever reads from QuickBooks', () => {
    // An Add/Mod/Del request would let a data-entry aid change the books.
    const requests = readFileSync(join(COMPANION, 'src', 'qbxml', 'requests.ts'), 'utf8');
    const built = requests.match(/<(\w+)Rq/g) ?? [];
    for (const element of built) {
      expect(element, requests).toMatch(/^<(QBXMLMsgs|\w*Query)Rq$/);
    }
    expect(companionOffenders(/InvoiceAddRq|InvoiceModRq|TxnDelRq/)).toEqual([]);
  });

  it('handles no QuickBooks credential', () => {
    expect(companionOffenders(/\bpassword\b/i)).toEqual([]);
    expect(companionOffenders(/\bcredential/i)).toEqual([]);
  });

  it('refuses XML declarations, so no entity expansion is possible', () => {
    const xml = readFileSync(join(COMPANION, 'src', 'qbxml', 'xml.ts'), 'utf8');
    expect(xml).toMatch(/Declarations \(DOCTYPE, ENTITY\) are not accepted/);
    expect(xml).toMatch(/MAX_XML_DEPTH/);
    expect(xml).toMatch(/MAX_XML_BYTES/);
  });

  it('builds no PowerShell command out of company data', () => {
    const script = readFileSync(join(COMPANION, 'powershell', 'QbxmlRequest.ps1'), 'utf8');
    expect(script).toMatch(/^\s*param\(/m);
    expect(script).not.toMatch(/Invoke-Expression|\biex\b/);
    // The request body travels as a file, never as an argument.
    expect(script).toMatch(/ReadAllText\(\$RequestPath/);

    const transport = readFileSync(join(COMPANION, 'src', 'transport', 'ComTransport.ts'), 'utf8');
    expect(transport).toContain("'-NoProfile'");
    expect(transport).toContain("'-NonInteractive'");
    expect(transport).toMatch(/mkdtempSync/);
    expect(transport).toMatch(/rmSync\(directory/);
  });
});
