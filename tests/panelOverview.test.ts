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
let session: Record<string, unknown>;
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

/**
 * Boot the helper the way `src/ui/sidePanel.ts` does: one surface, with the
 * workbook reader injected. There is no second surface to pass any more.
 */
async function open(): Promise<void> {
  const { startApp } = await import('../src/ui/app.js');
  const { createExcelImporter } = await import('../src/ui/importer.js');
  await startApp(createExcelImporter());
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
  session = {};
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
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(session, bag);
        }),
        remove: vi.fn(async (key: string) => {
          delete session[key];
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ ok: false, error: 'no tab' })),
      // The side panel outlives a tab switch, so it subscribes to these.
      onActivated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    windows: { onFocusChanged: { addListener: vi.fn() } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the overview with nothing imported', () => {
  it('offers the starting number on the panel', async () => {
    await open();

    expect(screen()).toContain('Nothing loaded');
    expect(headings()).toContain('Shipment Reference Number');
    expect(count('Set starting number')).toBe(1);
    expect(numberBox().placeholder).toBe('4088');
  });

  it('offers it in the side panel too, which is where a filer looks first', async () => {
    await open();

    expect(screen()).toContain('Nothing loaded');
    expect(count('Set starting number')).toBe(1);
  });

  it('seeds the sequence and keeps it in chrome.storage.local', async () => {
    await open();

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
    await open();

    expect(screen()).toContain('4088 is in use');
    expect(button('Mark 4088 as filed')).not.toBeNull();

    button('Mark 4088 as filed')?.click();
    await settle();

    expect(local[COUNTER_KEY]).toEqual({ lastFiled: 4088, reserved: null, configured: true });
    expect(screen()).toContain('Next: 4089');
  });

  it('refuses a number that is not one', async () => {
    await open();

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
    await open();

    expect(screen()).toContain('Status');
    expect(headings().filter((heading) => heading === 'Shipment Reference Number')).toHaveLength(1);
    expect(count('Set starting number')).toBe(1);
  });
});

/**
 * Reopening where the operator left off.
 *
 * The complaint, 2026-09-22: leaving the portal with the helper open and
 * coming back means opening it again. The surface answer is the side panel,
 * which Chrome does not destroy on a click into the form. This is the rest of
 * it: when the panel IS closed and reopened, it should not land on Overview
 * having forgotten the screen that was in front of the operator.
 *
 * Storage mechanics are pinned in tests/lastTab.test.ts; the subject here is
 * what the operator sees on the second open.
 */
describe('reopening the helper', () => {
  function tabStrip(): string[] {
    return Array.from(document.querySelectorAll('.tabs .tab')).map((node) => node.textContent ?? '');
  }

  function openTab(): string {
    return document.querySelector('.tabs .tab-active')?.textContent ?? '';
  }

  function pressTab(label: string): void {
    const tab = Array.from(document.querySelectorAll('.tabs .tab')).find((node) => node.textContent === label);
    if (!tab) throw new Error(`No tab labelled ${label}. Tabs: ${tabStrip().join(', ')}`);
    (tab as HTMLButtonElement).click();
  }

  it('opens on Overview the first time, with a shipment already loaded', async () => {
    imported = exampleImport();
    await open();

    expect(openTab()).toBe('Overview');
  });

  /**
   * The point of merging the wide panel in, 2026-09-22.
   *
   * Import, Mapping, Calculator, Settings and Diagnostics used to be on a
   * SECOND surface: a `panel.html` opened as a browser tab, one
   * `chrome.tabs.create` away, which then sat behind the portal. Whichever
   * surface the operator had open, the screen they wanted was usually on the
   * other one. This asserts the whole strip is here, because "no separation"
   * is the promise and a quietly dropped screen is how it would break.
   */
  it('carries every screen on the one surface', async () => {
    imported = exampleImport();
    await open();

    expect(tabStrip()).toEqual([
      'Overview',
      'Import',
      'Deckhand',
      'Package',
      'Preview',
      'Mapping',
      'Fill ACE',
      'Calculator',
      'Settings',
      'Diagnostics',
    ]);
  });

  it('opens the file picker screen itself, rather than sending the operator to a tab', async () => {
    // Chrome closes an ACTION POPUP when a file picker opens. It does not close
    // a side panel, which is what made the second surface unnecessary. So the
    // drop zone is here, and there is no "Open the panel" button left anywhere.
    await open();
    pressTab('Import');
    await settle();

    expect(document.querySelectorAll('#file-input')).toHaveLength(1);
    expect(document.querySelectorAll('#dropzone')).toHaveLength(1);
    expect(screen()).not.toContain('Open the panel');
    expect(screen()).not.toContain('Open full panel');
  });

  it('opens it again on the screen the operator chose', async () => {
    imported = exampleImport();
    await open();
    pressTab('Fill ACE');
    await settle();
    expect(openTab()).toBe('Fill ACE');

    // Close and reopen: a fresh app over the same browsing session.
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    await open();

    expect(openTab()).toBe('Fill ACE');
  });

  it('reopens on a screen that used to be the wide panel\'s, because it is this surface\'s now', async () => {
    imported = exampleImport();
    await open();
    pressTab('Mapping');
    await settle();
    expect(openTab()).toBe('Mapping');

    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    await open();

    // Before the merge this landed on Overview, because the side panel had no
    // Mapping tab to land on.
    expect(openTab()).toBe('Mapping');
  });

  it('keeps the remembered screen in the session area, never beside the settings', async () => {
    imported = exampleImport();
    await open();
    pressTab('Fill ACE');
    await settle();

    // A screen remembered past a browser restart opens onto a shipment this
    // session no longer has, and it is not a setting the operator chose.
    expect(Object.keys(session)).toContain('aceHelper.activeTab');
    expect(Object.keys(local)).not.toContain('aceHelper.activeTab');
  });
});
