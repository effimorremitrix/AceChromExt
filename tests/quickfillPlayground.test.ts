// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/playground/" }

/**
 * The Quickfill playground: the four AESDirect steps as pages opened from
 * disk, filled from the example workbook by the same content script that
 * runs on the portal.
 *
 * jsdom serves these documents from localhost, which is neither a CBP nor an
 * INTTRA host: exactly the playground's situation. The script must still
 * name the step from the page itself and fill it. Each page is opened under
 * its own file name, as on disk, because "parties" in step2-parties.html is
 * also a wording hint of INTTRA's B/L Documents screen, and in a real
 * Chromium that hint once named the ACE page INTTRA. Off both portals the
 * AESDirect detector speaks first.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickfillContentRequest, QuickfillContentResponse } from '../quickfill-extension/src/core/messages.js';
import { isFailure, parsePaste } from '../quickfill-extension/src/paste.js';
import { ACE_STEPS, PLAYGROUND_MATCHES, WORKBOOK_FILE, playgroundReadme, wrapAceScreen, writePlayground } from '../scripts/playground.mjs';
import { COLUMNS, EXAMPLE_ROWS } from '../scripts/templateData.mjs';

const FIXTURES = join(__dirname, 'fixtures');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

type Listener = (message: QuickfillContentRequest, sender: unknown, sendResponse: (response: QuickfillContentResponse) => void) => boolean;
const listeners: Listener[] = [];

function answer(message: QuickfillContentRequest): QuickfillContentResponse {
  const holder: { value: QuickfillContentResponse | null } = { value: null };
  for (const listener of listeners) {
    listener(message, null, (value) => {
      holder.value = value;
    });
  }
  if (!holder.value) vi.advanceTimersByTime(200);
  if (!holder.value) throw new Error('no response');
  return holder.value;
}

/** The workbook's rows as Excel puts them on the clipboard: the header row and the two lines, tab-separated. */
const PASTE = [COLUMNS.join('\t'), ...EXAMPLE_ROWS.map((row) => COLUMNS.map((column) => String(row[column] ?? '')).join('\t'))].join('\n');

function shipment() {
  const parsed = parsePaste(PASTE);
  if (isFailure(parsed)) throw new Error(parsed.error);
  return parsed;
}

const value = (id: string): string => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';

describe('the playground pages, filled from disk', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    listeners.length = 0;
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: (listener: Listener) => listeners.push(listener) }, sendMessage: async () => ({ ok: true }) },
    });
    vi.resetModules();
    await import('../quickfill-extension/src/content/quickfillContent.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads the workbook rows as two spreadsheet lines', () => {
    expect(shipment().summary).toBe('spreadsheet rows · BKG-5541220 · 1 container · 1 with a seal · 2 lines');
  });

  it('names each step from the page itself, off any portal', () => {
    for (const step of ACE_STEPS) {
      window.history.pushState({}, '', `/playground/${step.file}`);
      document.body.innerHTML = fixture(step.fixture);
      const response = answer({ type: 'content/where' });
      if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
      expect(response.payload).toMatchObject({ portal: 'ace', label: step.title, hasLines: step.step === 3 });
    }
  });

  it('fills Step 1 from the example: the reference, the departure date as MM/DD/YYYY, the state, the destination', () => {
    document.body.innerHTML = fixture('ace-shipment.html');
    const response = answer({ type: 'content/fillAce', shipment: shipment().ace, scope: 'shipment' });
    if (!response.ok || response.type !== 'content/count') throw new Error(`unexpected: ${JSON.stringify(response)}`);
    expect(value('shipmentReferenceNumber')).toBe('INV-20451');
    expect(value('estExportDate')).toBe('03/12/2026');
    expect(value('originState')).toBe('CA');
    expect(value('countryOfDestination')).toBe('IL');
  });

  it('fills the Ultimate Consignee on Step 2, and leaves the USPPI alone', () => {
    document.body.innerHTML = fixture('ace-parties.html');
    answer({ type: 'content/fillAce', shipment: shipment().ace, scope: 'shipment' });
    expect(value('p-c3')).toBe('MEDITERRANEAN FOODS LTD');
    expect(value('p-c4')).toBe('14 HARBOUR ROAD');
    expect(value('p-c5')).toBe('PORT INDUSTRIAL ZONE');
    expect(value('p-c8')).toBe('HAIFA');
    expect(value('p-c7')).toBe('3303201');
    expect(value('p-c6')).toBe('IL');
    expect(value('p-u3')).toBe('GALCO INTERNATIONAL');
  });

  it('fills line 1 on Step 3, pounds converted to whole kilograms', () => {
    document.body.innerHTML = fixture('ace-commodities.html');
    answer({ type: 'content/fillAce', shipment: shipment().ace, scope: 'commodityLine', line: 1 });
    expect(value('exportInformationCode')).toBe('OS');
    expect(value('scheduleBNumber')).toMatch(/^0802\.?12\.?0000$/);
    expect(value('commodityDescription')).toBe('SHELLED ALMONDS');
    expect(value('commodityLines[0].quantity1.stringField')).toBe('79833');
    expect(value('originOfGoods')).toBe('D');
    expect(value('commodityLines[0].goodsValue.stringField')).toBe('633600');
    expect(value('commodityLines[0].shipmentWeight.stringField')).toBe('79832');
    expect(value('eccn')).toBe('EAR99');
    expect(value('licenseCode')).toBe('C33');
  });

  it('fills Step 4 with the SCAC, the vessel and the booking', () => {
    document.body.innerHTML = fixture('ace-transportation.html');
    const response = answer({ type: 'content/fillAce', shipment: shipment().ace, scope: 'shipment' });
    if (!response.ok || response.type !== 'content/count') throw new Error('unexpected');
    expect(response.payload.filled).toBe(3);
    expect(value('carrierScacIata')).toBe('ZIMU');
    expect(value('shipmentInfo.conveyanceName.stringField')).toBe('ZIM SHANGHAI');
    expect(value('refNbrValue')).toBe('BKG-5541220');
  });

  it('offers nothing on a local page that is no step', () => {
    window.history.pushState({}, '', '/playground/README.md');
    document.body.innerHTML = '<p>Welcome</p>';
    const response = answer({ type: 'content/where' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload.portal).toBe('none');
    expect(response.payload.label).toMatch(/neither an AESDirect step nor an INTTRA screen/);
  });
});

describe('the playground folder', () => {
  it('wraps every fixture as a page whose tabs link the four files, keeping every id', () => {
    for (const step of ACE_STEPS) {
      const fragment = fixture(step.fixture);
      const page = wrapAceScreen(fragment, step);
      expect(page.startsWith('<!doctype html>')).toBe(true);
      expect(page).toContain(`<title>ACE playground: ${step.title}</title>`);
      expect(page).not.toContain('href="#step');
      for (const other of ACE_STEPS) expect(page).toContain(`href="${other.file}"`);
      for (const id of fragment.match(/ id="[^"]+"/g) ?? []) expect(page).toContain(id);
      expect(page).not.toMatch(/eval\(|new Function/);
    }
  });

  it('matches local pages only, never a portal', () => {
    expect(PLAYGROUND_MATCHES).toEqual(['file:///*', 'http://127.0.0.1/*', 'http://localhost/*']);
    expect(PLAYGROUND_MATCHES.join(' ')).not.toMatch(/cbp|inttra|e2open|<all_urls>/);
  });

  it('writes the four pages, the workbook and the README, with the workbook rows as the paste', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quickfill-playground-'));
    const files = writePlayground(dir, { fixtures: FIXTURES, stamp: '0.1.0+test' });
    expect(files).toEqual([...ACE_STEPS.map((step) => step.file), WORKBOOK_FILE, 'README.md']);
    const workbook = XLSX.read(readFileSync(join(dir, WORKBOOK_FILE)), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Shipment']);
    const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['Shipment'] as XLSX.WorkSheet, { header: 1 });
    expect(rows[0]).toEqual([...COLUMNS]);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.[COLUMNS.indexOf('Carrier')]).toBe('ZIMU');
    expect(rows[1]?.[COLUMNS.indexOf('ContainerNumber')]).toBe('ZIMU1234569');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('Allow access to file URLs');
    expect(playgroundReadme('0.1.0+test')).toContain('0.1.0+test');
  });
});
