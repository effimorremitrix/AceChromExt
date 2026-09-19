/**
 * The ACE Helper overview, in jsdom.
 *
 * One claim, and it is the one that failed an operator on 2026-09-19: the
 * Shipment Reference Number block is on the overview BEFORE anything is
 * imported. The counter is operator state in `chrome.storage.local`, not
 * shipment data, so the sequence is seeded on the day the extension is
 * installed; behind an import, the first filing was the earliest it could be
 * set, and a filer told to "type 4088 in the overview box" found no box.
 *
 * The retire button matters here for the same reason the counter reserves
 * rather than increments: a number in flight that nobody can see is a number
 * that gets handed out twice. So it too must survive the empty state.
 *
 * `chrome` is stubbed with what `startApp` touches: `storage.local` for the
 * settings, the counter and the selector overrides, `runtime.sendMessage` for
 * the imported shipment and the session log, and `tabs.query` for the ACE tab.
 * What the counter itself does is tested in tests/referenceCounter.test.ts;
 * here the screen is the subject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import type { StoredImport } from '../src/core/messages.js';
import { readWorkbookBytes } from '../src/excel/excelReader.js';
import { loadWorkbook } from '../src/sources/index.js';
import { COLUMNS, EXAMPLE_ROWS } from '../scripts/templateData.mjs';

const COUNTER_KEY = 'aceHelper.referenceCounter';

let local: Record<string, unknown>;
let imported: StoredImport | null;

/** Let startApp's loads and the click handlers' promises settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

/** The one button carrying this label. */
function button(label: string): HTMLButtonElement | null {
  const match = Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label);
  return (match ?? null) as HTMLButtonElement | null;
}

function count(label: string): number {
  return Array.from(document.querySelectorAll('button')).filter((node) => node.textContent === label).length;
}

function headings(): string[] {
  return Array.from(document.querySelectorAll('h2')).map((node) => node.textContent ?? '');
}

function screen(): string {
  return document.querySelector('#root')?.textContent ?? '';
}

function numberBox(): HTMLInputElement {
  const input = document.querySelector('input[aria-label="Next Shipment Reference Number"]');
  if (!input) throw new Error(`No reference number box on screen. Headings: ${headings().join(', ')}`);
  return input as HTMLInputElement;
}

async function open(surface: 'panel' | 'popup'): Promise<void> {
  const { startApp } = await import('../src/ui/app.js');
  await startApp(surface);
  await settle();
}

/**
 * The example rows from scripts/templateData.mjs - the same data the template
 * and the playground carry - loaded the way the Import tab loads a workbook.
 */
function exampleImport(): StoredImport {
  const rows = EXAMPLE_ROWS.map((row) => COLUMNS.map((column) => row[column] ?? ''));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]), 'Shipment');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const loaded = loadWorkbook(readWorkbookBytes(bytes, 'ACE_Invoice_CN-1042.xlsx'), { settings: DEFAULT_SETTINGS });
  return { shipment: loaded.shipment, validation: loaded.validation, notes: loaded.notes, selectedLine: 1 };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  local = {};
  imported = null;

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({ version: '0.1.0', version_name: '0.1.0+test' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async (message: { type: string }) => {
        if (message.type === 'store/get') {
          return imported ? { ok: true, type: 'store/data', payload: imported } : { ok: false, error: 'nothing stored' };
        }
        if (message.type === 'log/get') return { ok: true, type: 'log/data', payload: [] };
        return { ok: false, error: `no stub for ${message.type}` };
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in local ? { [key]: local[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(local, bag);
        }),
        remove: vi.fn(async (key: string) => {
          delete local[key];
        }),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => ({ ok: false, error: 'no tab' })) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the overview with nothing imported', () => {
  it('offers the starting number on the panel', async () => {
    await open('panel');

    expect(screen()).toContain('Nothing loaded');
    expect(headings()).toContain('Shipment Reference Number');
    expect(count('Set starting number')).toBe(1);
    expect(numberBox().placeholder).toBe('4088');
  });

  it('offers it in the popup too, which is where a filer looks first', async () => {
    await open('popup');

    expect(screen()).toContain('Nothing loaded');
    expect(count('Set starting number')).toBe(1);
  });

  it('seeds the sequence and keeps it in chrome.storage.local', async () => {
    await open('panel');

    numberBox().value = '4088';
    button('Set starting number')?.click();
    await settle();

    // They last filed 4087 outside the system, so 4088 is what comes next.
    expect(local[COUNTER_KEY]).toEqual({ lastFiled: 4087, reserved: null, configured: true });
    expect(screen()).toContain('Next: 4088');
    expect(button('Set next number')).not.toBeNull();
    expect(button('Set starting number')).toBeNull();
  });

  it('shows a number already in flight, and the button that retires it', async () => {
    local[COUNTER_KEY] = { lastFiled: 4087, reserved: 4088, configured: true };
    await open('panel');

    expect(screen()).toContain('4088 is in use');
    expect(button('Mark 4088 as filed')).not.toBeNull();

    button('Mark 4088 as filed')?.click();
    await settle();

    expect(local[COUNTER_KEY]).toEqual({ lastFiled: 4088, reserved: null, configured: true });
    expect(screen()).toContain('Next: 4089');
  });

  it('refuses a number that is not one', async () => {
    await open('panel');

    numberBox().value = '0';
    button('Set starting number')?.click();
    await settle();

    expect(local[COUNTER_KEY]).toBeUndefined();
    expect(screen()).toContain('Enter the next reference number');
  });
});

describe('the overview with a workbook loaded', () => {
  it('carries the same block, once, beside the fill buttons', async () => {
    imported = exampleImport();
    await open('panel');

    expect(screen()).toContain('Status');
    expect(headings().filter((heading) => heading === 'Shipment Reference Number')).toHaveLength(1);
    expect(count('Set starting number')).toBe(1);
  });
});
