/**
 * The ACE Helper playground: the build that lets the panel be driven without
 * the portal.
 *
 * The ACE Helper's manifest names CBP hosts only, so Chrome never injects its
 * content script into a page opened from disk and the panel says "No ACE tab
 * detected" beside a mock step. `npm run build:playground` is the answer: the
 * same bundles under a manifest that names local pages instead. Two claims
 * follow from that, and both are pinned here.
 *
 * 1. The playground manifest cannot reach a portal. It is generated, so the
 *    assertion is on the generator rather than on a folder some build left
 *    behind: no CBP host in any field, `permissions: ["storage"]` and the CSP
 *    untouched.
 * 2. The panel finds a playground page. `resolveAceTab` no longer tests URLs
 *    itself; it searches the patterns this build's own manifest declares, so
 *    the shipping build still finds CBP tabs and only CBP tabs.
 *
 * The pages are the same four mock steps the Quickfill playground ships
 * (tests/quickfillPlayground.test.ts covers them from that side), so what is
 * new here is that the ACE Helper's own filler writes into them.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACE_STEPS, HELPERS, PLAYGROUND_MATCHES, WORKBOOK_FILE, exampleWorkbook, playgroundManifest, playgroundReadme, wrapAceScreen, writePlayground } from '../scripts/playground.mjs';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { fillFields } from '../src/content/filler.js';
import { readWorkbookBytes } from '../src/excel/excelReader.js';
import { loadWorkbook } from '../src/sources/index.js';
import { ACE_URL_PATTERNS, resolveAceTab, tabPatterns } from '../src/ui/tabs.js';
import type { CanonicalShipment } from '../src/models/CanonicalInvoice.js';

const FIXTURES = join(__dirname, 'fixtures');
const SHIPPING_MANIFEST = JSON.parse(readFileSync(join(__dirname, '..', 'extension', 'manifest.json'), 'utf8')) as Record<string, unknown>;

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** The workbook the playground ships, read the way the Import tab reads it. */
function exampleShipment(): CanonicalShipment {
  const bytes = new Uint8Array(exampleWorkbook());
  return loadWorkbook(readWorkbookBytes(bytes, WORKBOOK_FILE), { settings: DEFAULT_SETTINGS }).shipment;
}

/** A playground page as a document, exactly as it is written to disk. */
function pageFor(step: (typeof ACE_STEPS)[number]): Document {
  return new DOMParser().parseFromString(wrapAceScreen(fixture(step.fixture), step, HELPERS.ace), 'text/html');
}

const value = (doc: Document, id: string): string =>
  (doc.querySelector(`[id="${id}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';

describe('the playground manifest', () => {
  const manifest = playgroundManifest(SHIPPING_MANIFEST, HELPERS.ace);

  it('names no portal host anywhere', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/cbp|dhs\.gov|inttra|e2open|<all_urls>/i);
    expect(manifest['host_permissions']).toEqual(PLAYGROUND_MATCHES);
    for (const script of manifest['content_scripts'] as Array<{ matches: string[] }>) {
      expect(script.matches).toEqual(PLAYGROUND_MATCHES);
    }
  });

  it('cannot be mistaken for the real build', () => {
    expect(manifest['name']).toBe('ACE Helper (playground)');
    expect((manifest['action'] as { default_title: string }).default_title).toBe('ACE Helper (playground)');
    expect(manifest['description']).toContain('never on ACE');
  });

  it('widens nothing else: the permission, the CSP and the shipping manifest are untouched', () => {
    expect(manifest['permissions']).toEqual(['storage']);
    expect(manifest['content_security_policy']).toEqual(SHIPPING_MANIFEST['content_security_policy']);
    expect(manifest['web_accessible_resources']).toBeUndefined();
    // The generator copies; it must not have edited the manifest it was given.
    expect(SHIPPING_MANIFEST['name']).toBe('ACE Helper');
    expect(SHIPPING_MANIFEST['host_permissions']).toEqual([
      'https://ace.cbp.dhs.gov/*',
      'https://aesdirect.cbp.dhs.gov/*',
      'https://*.cbp.dhs.gov/*',
    ]);
  });

  it('keeps host_permissions, which the Quickfill playground drops', () => {
    // Not an oversight either way: the ACE panel finds its tab by URL, and
    // Chrome hands over a tab's url only for a host the extension may see.
    expect(playgroundManifest(SHIPPING_MANIFEST, HELPERS.quickfill)['host_permissions']).toBeUndefined();
  });
});

describe('the playground folder', () => {
  it('wraps the four steps with the ACE Helper banner and the workbook instruction', () => {
    for (const step of ACE_STEPS) {
      const page = wrapAceScreen(fixture(step.fixture), step, HELPERS.ace);
      expect(page).toContain('<strong>ACE Helper playground.</strong>');
      expect(page).toContain('Import the example workbook in the panel');
      expect(page).not.toContain('Paste the example rows into Quickfill');
      for (const other of ACE_STEPS) expect(page).toContain(`href="${other.file}"`);
      expect(page).not.toMatch(/eval\(|new Function/);
    }
  });

  it('writes the four pages, the workbook and a README addressed to the ACE Helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ace-playground-'));
    const files = writePlayground(dir, { fixtures: FIXTURES, stamp: '0.1.0+test', helper: HELPERS.ace });
    expect(files).toEqual([...ACE_STEPS.map((step) => step.file), WORKBOOK_FILE, 'README.md']);

    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('0.1.0+test');
    expect(readme).toContain('ACE Helper (playground)');
    expect(readme).toContain('Allow access to file URLs');
    expect(readme).toContain(WORKBOOK_FILE);
    // The honesty this build must never lose.
    expect(readme).toContain('Select2');
    expect(readme).toContain('label wording only');
    expect(readme).toContain('Never file from this build');
  });

  it('leaves the Quickfill README alone', () => {
    expect(playgroundReadme('0.1.0+test', HELPERS.quickfill)).toContain('# Quickfill playground');
    expect(playgroundReadme('0.1.0+test', HELPERS.ace)).toContain('# ACE Helper playground');
  });
});

describe('filling a playground page with the ACE Helper', () => {
  const shipment = exampleShipment();

  it('fills Step 1 from the example workbook, transformations and all', () => {
    const doc = pageFor(ACE_STEPS[0]!);
    const report = fillFields({ shipment, page: 'shipment', scope: 'shipment', settings: DEFAULT_SETTINGS }, doc);

    expect(report.filled).toBeGreaterThan(0);
    expect(report.errors).toBe(0);
    expect(value(doc, 'shipmentReferenceNumber')).toBe('INV-20451');
    expect(value(doc, 'originState')).toBe('CA');
    expect(value(doc, 'countryOfDestination')).toBe('IL');
  });

  it('writes the operator reference number when the counter is set up', () => {
    const doc = pageFor(ACE_STEPS[0]!);
    fillFields(
      { shipment, page: 'shipment', scope: 'shipment', settings: DEFAULT_SETTINGS, operator: { shipmentReference: '4088' } },
      doc,
    );
    expect(value(doc, 'shipmentReferenceNumber')).toBe('4088');
  });

  it('fills a commodity line on Step 3, converting the weight', () => {
    const doc = pageFor(ACE_STEPS[2]!);
    fillFields({ shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS }, doc);

    expect(value(doc, 'scheduleBNumber')).toBe('0802.12.0000');
    expect(value(doc, 'commodityDescription')).toBe('SHELLED ALMONDS');
    // 176,000 lb x 0.45359237, to whole kilograms.
    expect(value(doc, 'commodityLines[0].shipmentWeight.stringField')).toBe('79832');
    expect(value(doc, 'eccn')).toBe('EAR99');
  });

  it('never presses a button on the page', () => {
    const doc = pageFor(ACE_STEPS[2]!);
    const save = doc.querySelector('[id="saveLine"]') as HTMLButtonElement;
    let pressed = 0;
    save.addEventListener('click', () => { pressed += 1; });
    fillFields({ shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS }, doc);
    expect(pressed).toBe(0);
  });
});

describe('the panel finding its tab', () => {
  let manifest: Record<string, unknown>;
  let tabs: chrome.tabs.Tab[];
  let queried: Array<Record<string, unknown>>;

  beforeEach(() => {
    manifest = SHIPPING_MANIFEST;
    tabs = [];
    queried = [];
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => manifest },
      tabs: {
        query: vi.fn(async (info: Record<string, unknown>) => {
          queried.push(info);
          if (info['active']) return tabs.filter((tab) => tab.active);
          const patterns = info['url'] as string[] | undefined;
          if (!patterns) return tabs;
          return tabs.filter((tab) => patterns.some((pattern) => matches(pattern, tab.url ?? '')));
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Chrome's match patterns, enough of them for these cases. */
  function matches(pattern: string, url: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`).test(url);
  }

  const tab = (id: number, url: string, extra: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab =>
    ({ id, url, title: url, active: false, lastAccessed: id, ...extra }) as chrome.tabs.Tab;

  it('searches what the shipping manifest declares', () => {
    expect(tabPatterns()).toEqual(ACE_URL_PATTERNS);
  });

  it('searches local pages under the playground manifest, and nothing else', () => {
    manifest = playgroundManifest(SHIPPING_MANIFEST, HELPERS.ace);
    expect(tabPatterns()).toEqual(PLAYGROUND_MATCHES);
    expect(tabPatterns().join(' ')).not.toMatch(/cbp/);
  });

  it('falls back to the shipping patterns where there is no manifest to read', () => {
    manifest = {};
    expect(tabPatterns()).toEqual(ACE_URL_PATTERNS);
  });

  it('prefers the ACE tab being looked at', async () => {
    tabs = [
      tab(1, 'https://ace.cbp.dhs.gov/ace/filing/shipment'),
      tab(2, 'https://ace.cbp.dhs.gov/ace/filing/commodities', { active: true }),
    ];
    expect(await resolveAceTab()).toMatchObject({ id: 2 });
  });

  it('falls back to the most recently used one when the panel is in front', async () => {
    tabs = [
      tab(1, 'https://ace.cbp.dhs.gov/ace/filing/shipment', { lastAccessed: 10 }),
      tab(2, 'https://aesdirect.cbp.dhs.gov/ace/filing/commodities', { lastAccessed: 99 }),
      tab(3, 'chrome-extension://abc/panel.html', { active: true }),
    ];
    expect(await resolveAceTab()).toMatchObject({ id: 2 });
  });

  it('finds a page opened from disk only under the playground manifest', async () => {
    tabs = [tab(7, 'file:///C:/AceChromExt/dist-ace-playground/playground/step1-shipment.html', { active: true })];

    expect(await resolveAceTab()).toBeNull();

    manifest = playgroundManifest(SHIPPING_MANIFEST, HELPERS.ace);
    expect(await resolveAceTab()).toMatchObject({ id: 7 });
  });

  it('never finds a portal page under the playground manifest', async () => {
    manifest = playgroundManifest(SHIPPING_MANIFEST, HELPERS.ace);
    tabs = [tab(9, 'https://ace.cbp.dhs.gov/ace/filing/shipment', { active: true })];
    expect(await resolveAceTab()).toBeNull();
  });
});
