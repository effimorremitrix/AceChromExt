/**
 * The operator dashboard's promises, asserted against its source and its
 * hosting configuration, in the spirit of tests/invariants.test.ts.
 *
 * The dashboard is a static page that does everything in the browser. It
 * must not be able to send shipment data anywhere, keep it in browser
 * storage, reach into any extension's content layer or the companion's
 * runtime, or fill a portal. A future developer who adds "just one API
 * call" fails this file first.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const WEB = join(ROOT, 'web');
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
const sources = walk(join(WEB, 'src'), '.ts').map((path) => ({ path: path.replace(`${posix(ROOT)}/`, ''), code: stripComments(readFileSync(path, 'utf8')) }));
const offenders = (pattern: RegExp): string[] => sources.filter(({ code }) => pattern.test(code)).map(({ path }) => path);

describe('the dashboard sends nothing anywhere', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('never calls fetch, XMLHttpRequest, WebSocket, sendBeacon, EventSource, or a service worker', () => {
    expect(offenders(/\bfetch\s*\(/)).toEqual([]);
    expect(offenders(/XMLHttpRequest/)).toEqual([]);
    expect(offenders(/new\s+WebSocket|new\s+EventSource|new\s+Request\s*\(/)).toEqual([]);
    expect(offenders(/sendBeacon|navigator\.connection|navigator\.share/)).toEqual([]);
    expect(offenders(/serviceWorker|importScripts/)).toEqual([]);
    expect(offenders(/postMessage|BroadcastChannel|SharedWorker|new\s+Worker\s*\(/)).toEqual([]);
  });

  it('names no http(s) URL at all', () => {
    const urls = sources.flatMap(({ code }) => code.match(/https?:\/\/[^\s'"`)]+/g) ?? []);
    expect(urls).toEqual([]);
  });

  it('keeps shipment data out of browser storage', () => {
    expect(offenders(/localStorage|sessionStorage|indexedDB|openDatabase|\bcaches\b|navigator\.storage|document\.cookie/)).toEqual([]);
  });

  it('never calls eval, new Function, a string timer, or a computed import', () => {
    expect(offenders(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*['"`]/)).toEqual([]);
    expect(offenders(/set(?:Timeout|Interval)\s*\(\s*['"`]/)).toEqual([]);
    expect(offenders(/import\s*\(\s*(?!['"])/)).toEqual([]);
  });

  it('handles no credential', () => {
    expect(offenders(/\bpassword\b/i)).toEqual([]);
    expect(offenders(/\bcredential/i)).toEqual([]);
    expect(offenders(/type\s*=\s*['"]password['"]/)).toEqual([]);
  });

  it('assigns innerHTML only from string literals, if at all', () => {
    for (const { path, code } of sources) {
      for (const assignment of code.match(/innerHTML\s*=\s*[^;]+/g) ?? []) {
        expect(assignment, path).toMatch(/innerHTML\s*=\s*'[^'${}+]*'/);
      }
    }
  });
});

describe('the dashboard cannot fill a portal', () => {
  it('imports no content script, no field writer, no filler, no grid writer', () => {
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*\/content\//);
      expect(code, path).not.toMatch(/setAceFieldValue|setInttraFieldValue|fillFields|fillInttraFields|fillContainerGrid|detectField/);
    }
  });

  it('never submits a form or navigates', () => {
    expect(offenders(/\.submit\s*\(|requestSubmit|location\s*\.\s*(href|assign|replace)\s*=|window\.open/)).toEqual([]);
  });

  it('uses no chrome.* API, so it can never become an extension page by accident', () => {
    expect(offenders(/\bchrome\./)).toEqual([]);
  });
});

describe('the dashboard reuses the domain code and nothing runtime-specific', () => {
  it('imports only pure modules from the extensions and the companion', () => {
    const forbidden = [
      /\/src\/background\//,
      /\/src\/core\/(store|messages|sessionLog|logger)\.js/,
      /\/src\/ui\/(app|panel|popup|tabs|importer|diagnostics|calculatorPanel)\.js/,
      /\/src\/ace\/selectors\/overridesStore\.js/,
      /\/src\/calculator\//,
      /inttra-extension\/src\/(content|core|ui|background)\//,
      /companion\/src\/(transport|qbxml|ui|adapter|package|config|main)/,
      /from\s+['"]node:/,
    ];
    for (const { path, code } of sources) {
      for (const pattern of forbidden) expect(code, `${path} imports ${pattern}`).not.toMatch(new RegExp(`from\\s+['"][^'"]*${pattern.source.replace(/^from\\s\+\['"\]/, '')}`));
    }
  });

  it('is imported by nothing that ships in an extension or the companion', () => {
    const local = ['src', 'inttra-extension', 'quickfill-extension', 'companion', 'deckhand', 'shared'].flatMap((dir) => walk(join(ROOT, dir), '.ts'));
    for (const path of local) {
      expect(stripComments(readFileSync(path, 'utf8')), path).not.toMatch(/from\s+['"][^'"]*\/web\//);
    }
  });

  it('leaves every extension manifest on its own permissions, portal hosts only, no dashboard host', () => {
    // One expected set per manifest, so a permission can only ever be added by
    // editing this line. Quickfill's `scripting` is the panel starting its own
    // content script in a tab that has none, and nothing else: what it may
    // inject is pinned in tests/quickfillInvariants.test.ts. `sidePanel` is a
    // surface and only a surface, and on all three it REPLACED the action
    // popup rather than adding to it: tests/invariants.test.ts says why.
    // No manifest here declares a `default_popup` any more.
    const expected: Array<[string, string[]]> = [
      [join(ROOT, 'extension', 'manifest.json'), ['storage', 'sidePanel']],
      [join(ROOT, 'inttra-extension', 'manifest.json'), ['storage', 'sidePanel']],
      [join(ROOT, 'quickfill-extension', 'manifest.json'), ['storage', 'scripting', 'sidePanel']],
    ];
    for (const [manifestPath, permissions] of expected) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      expect(manifest['permissions'], manifestPath).toEqual(permissions);
      // Whatever a manifest may ask for, none of them may reach the network,
      // hold a cookie, watch the browser, or talk to the dashboard.
      for (const never of ['cookies', 'webRequest', 'webRequestBlocking', 'declarativeNetRequest', 'downloads', 'history', 'management', 'nativeMessaging', 'proxy', 'tabs', 'debugger']) {
        expect(manifest['permissions'], `${manifestPath} asks for ${never}`).not.toContain(never);
      }
      expect(manifest['action'], manifestPath).not.toHaveProperty('default_popup');
      const csp = (manifest['content_security_policy'] as { extension_pages: string }).extension_pages;
      expect(csp).toContain("connect-src 'none'");
      expect(JSON.stringify(manifest)).not.toMatch(/workers\.dev|pages\.dev|dashboard|externally_connectable|<all_urls>/);
    }
  });

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['xlsx']);
    expect(Object.keys(pkg.devDependencies ?? {}).some((name) => /wrangler|cloudflare|react|vue|svelte|next/i.test(name))).toBe(false);
    expect(pkg.scripts['build:web']).toBeDefined();
    expect(pkg.scripts['check:bundle:web']).toContain('--allow none');
    expect(pkg.scripts['verify']).toContain('build:web');
    expect(pkg.scripts['verify']).toContain('check:bundle:web');
  });
});

describe('the hosted page and its host', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const headers = readFileSync(join(WEB, '_headers'), 'utf8');
  const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'";

  it('pins a CSP that allows its own script and stylesheet and no connection, in the page and in the response headers', () => {
    expect(html).toContain(`content="${CSP}"`);
    // frame-ancestors only works as a header, so the header carries the same policy plus that.
    expect(headers).toContain(`Content-Security-Policy: ${CSP}; frame-ancestors 'none'`);
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Cache-Control: no-store');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it('loads exactly one local script and no remote resource', () => {
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toEqual(['<script src="dashboard.js">']);
    expect(html).not.toMatch(/https?:\/\//);
    // No favicon request either: the icon is an empty data URL.
    expect(html).toContain('<link rel="icon" href="data:," />');
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('is configured as static assets only: no Worker script, no binding, no route into anything', () => {
    const raw = readFileSync(join(WEB, 'wrangler.jsonc'), 'utf8');
    const config = JSON.parse(stripComments(raw)) as Record<string, unknown> & { assets: { directory: string }; env?: Record<string, Record<string, unknown>> };
    const BINDINGS = ['main', 'kv_namespaces', 'd1_databases', 'r2_buckets', 'durable_objects', 'queues', 'ai', 'services', 'vectorize', 'hyperdrive', 'analytics_engine_datasets', 'browser', 'dispatch_namespaces', 'send_email', 'mtls_certificates', 'tail_consumers', 'triggers', 'vars', 'secrets_store_secrets', 'pipelines', 'workflows'];
    for (const key of BINDINGS) expect(config, key).not.toHaveProperty(key);
    expect(config.assets.directory).toBe('../dist-web');
    for (const [name, env] of Object.entries(config.env ?? {})) {
      for (const key of BINDINGS) expect(env, `env.${name}.${key}`).not.toHaveProperty(key);
      expect((env['assets'] as { directory: string }).directory).toBe('../dist-web');
    }
  });

  it('builds with the repository build tool into a checked bundle', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'build-web.mjs'), 'utf8');
    expect(script).toMatch(/from 'esbuild'/);
    expect(script).toContain("host: '127.0.0.1'");
    // The only URL it prints is the loopback dev server's own address.
    expect(script.match(/https?:\/\/[^\s'"`)]+/g)).toEqual(['http://${server.host}:${server.port}/']);
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run build:web');
    expect(ci).toContain('npm run check:bundle:web');
  });
});
