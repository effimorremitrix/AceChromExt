/**
 * The INTTRA content script's own wiring: page and grid status, the grid
 * gate, the paste block, and which frame answers first.
 *
 * The screen is the live modal of 2026-09-17: a step strip that still names
 * B/L Documents, a Parties heading behind the modal, the captured wrapper
 * markup, and a grid whose seal headings are dropdowns and whose cells hold
 * no control until clicked.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InttraContentRequest, InttraContentResponse } from '../inttra-extension/src/core/messages.js';
import { approveDeckhand, buildFilingPackage, type FilingPackage } from '../shared/src/index.js';
import { extractWithRules } from '../deckhand/src/index.js';

type Listener = (message: InttraContentRequest, sender: unknown, sendResponse: (response: InttraContentResponse) => void) => boolean;

const listeners: Listener[] = [];

function installChromeStub(): void {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
      sendMessage: async () => ({ ok: true }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => {
          delete store[key];
        },
      },
      onChanged: { addListener: () => undefined },
    },
  };
}

/** Deliver a message. `kept` is what the listener returned: true means it kept the port open to answer later. */
function ask(message: InttraContentRequest): { get: () => InttraContentResponse | null; kept: boolean } {
  const holder: { value: InttraContentResponse | null } = { value: null };
  let kept = false;
  for (const listener of listeners) {
    const keep = listener(message, null, (value) => {
      holder.value = value;
    });
    kept = kept || keep;
  }
  return { get: () => holder.value, kept };
}

/** The answer, waiting out the quiet-frame delay when the document has nothing structural on it. */
function answer(message: InttraContentRequest): InttraContentResponse {
  const sent = ask(message);
  if (!sent.get()) vi.advanceTimersByTime(200);
  const response = sent.get();
  if (!response) throw new Error('no response');
  return response;
}

function samplePackage(): FilingPackage {
  const shipment = extractWithRules(readFileSync(join(__dirname, 'fixtures', 'deckhand', '04-booking-confirmation.txt'), 'utf8'));
  return approveDeckhand(buildFilingPackage({ shipment, now: new Date('2026-09-14T00:00:00Z') }), new Date('2026-09-14T00:00:00Z'));
}

const BEHIND_THE_MODAL = '<nav><a class="nav-link active">B/L Documents</a></nav><h2>Parties</h2>';
const HEADER_ROW = [
  '<thead><tr><th>*Container Number</th>',
  '<th><select><option selected>Carrier Seal #</option><option>Shipper Seal #</option><option>Customs Seal #</option></select></th>',
  '<th><select><option>Carrier Seal #</option><option selected>Shipper Seal #</option><option>Customs Seal #</option></select></th>',
  '<th>HS Code</th></tr></thead>',
].join('');
const CLICK_TO_EDIT_ROWS = '<tbody>' + '<tr><td></td><td></td><td></td><td></td></tr>'.repeat(3) + '</tbody>';
const INPUT_ROWS = '<tbody>' + '<tr><td><input /></td><td><input /></td><td><input /></td><td><input /></td></tr>'.repeat(3) + '</tbody>';

/** The captured wrapper markup, as on the live modal, around a grid. */
function modal(rows: string): string {
  return [
    BEHIND_THE_MODAL,
    '<div id="siCopyContainerWrapperDiv" class="preLoaderWrapper">',
    '<div class="preLoaderMask" id="preLoaderMaskSiCopyContainer" style="display: none;"></div>',
    '<div class="preLoader" id="preLoaderSiCopyContainer" style="display: none;"></div>',
    `<div id="editableGridWrapper" class="col-sm-12 pushdown10"><table>${HEADER_ROW}${rows}</table></div>`,
    '<div class="modal-footer"></div></div>',
  ].join('');
}

describe('INTTRA content script', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    listeners.length = 0;
    installChromeStub();
    document.body.innerHTML = modal(CLICK_TO_EDIT_ROWS);
    vi.resetModules();
    await import('../inttra-extension/src/content/inttraContent.js');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a ping with its version', () => {
    expect(answer({ type: 'content/ping' })).toMatchObject({ ok: true, type: 'content/pong' });
  });

  it('reports Copy Container Details with a grid that cannot be typed into, whatever the strip says, and answers at once', () => {
    const sent = ask({ type: 'content/detectPage' });
    expect(sent.kept).toBe(false);
    const response = sent.get();
    if (!response?.ok || response.type !== 'content/page') throw new Error('unexpected');
    expect(response.payload.page).toBe('copyContainerDetails');
    expect(response.payload.confidence).toBe('high');
    expect(response.grid).toEqual({ found: true, acceptsTyping: false });
  });

  it('waits a moment before answering from a document with nothing structural on it', () => {
    // With the helper in every frame of the tab and the panel keeping the
    // first reply, the frame that holds the screen must be the one to answer.
    document.body.innerHTML = BEHIND_THE_MODAL;
    const sent = ask({ type: 'content/detectPage' });
    expect(sent.kept).toBe(true);
    expect(sent.get()).toBeNull();
    vi.advanceTimersByTime(150);
    const response = sent.get();
    if (!response?.ok || response.type !== 'content/page') throw new Error('unexpected');
    expect(response.payload.page).toBe('blDocuments');
    expect(response.grid).toEqual({ found: false, acceptsTyping: false });
  });

  it('refuses to fill the grid on a screen that has none, and says which screen it saw', () => {
    document.body.innerHTML = BEHIND_THE_MODAL;
    const response = answer({ type: 'content/fillGrid', package: samplePackage() });
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unexpected');
    expect(response.error).toMatch(/B\/L Documents/);
    expect(response.error).toMatch(/no container grid/);
  });

  it('fills the grid behind a B/L Documents strip without the any-page override', () => {
    document.body.innerHTML = modal(INPUT_ROWS);
    const response = answer({ type: 'content/fillGrid', package: samplePackage() });
    if (!response.ok || response.type !== 'content/gridReport') throw new Error(`unexpected: ${JSON.stringify(response)}`);
    expect(response.payload.containersFilled).toBe(3);
    expect(response.payload.failed).toBe(0);
    expect(response.payload.cells.filter((cell) => cell.column === 'ShipperSeal' && cell.status === 'verified')).toHaveLength(2);
  });

  it('reports every cell of a click-to-edit grid unresolved rather than clicking one', () => {
    const response = answer({ type: 'content/fillGrid', package: samplePackage() });
    if (!response.ok || response.type !== 'content/gridReport') throw new Error('unexpected');
    expect(response.payload.verifiedCells).toBe(0);
    expect(response.payload.unresolved).toBeGreaterThan(0);
  });

  it('carries, in Diagnostics, what the document is built from', () => {
    const response = answer({ type: 'content/diagnostics' });
    if (!response.ok || response.type !== 'content/diagnostics') throw new Error('unexpected');
    const structure = response.payload.structure;
    expect(structure.topFrame).toBe(true);
    expect(structure.markers).toContainEqual({ selector: '#siCopyContainerWrapperDiv', state: 'visible' });
    expect(structure.markers).toContainEqual({ selector: '#editableGridWrapper', state: 'visible' });
    expect(structure.containerNumber[0]?.rows.some((row) => row.cells[0] === '*Container Number' && row.cells[2] === 'Shipper Seal #')).toBe(true);
    expect(response.payload.grid.attempts.every((attempt) => typeof attempt.raw === 'number')).toBe(true);
  });

  it('finds the grid of the fifth run, which is not a table, and answers at once', () => {
    document.body.innerHTML = readFileSync(join(__dirname, 'fixtures', 'inttra-div-grid.html'), 'utf8');
    const sent = ask({ type: 'content/detectPage' });
    expect(sent.kept).toBe(false);
    const page = sent.get();
    if (!page?.ok || page.type !== 'content/page') throw new Error('unexpected');
    expect(page.payload.page).toBe('copyContainerDetails');
    expect(page.grid).toEqual({ found: true, acceptsTyping: false });
    const rows = answer({ type: 'content/gridRows', package: samplePackage() });
    if (!rows.ok || rows.type !== 'content/rows') throw new Error('unexpected');
    expect(rows.payload.fromGrid).toBe(true);
    expect(rows.payload.columns.map((column) => column.heading)).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #']);
  });

  it('returns the paste block in the grid’s own order, with the seal columns identified by their dropdowns', () => {
    const response = answer({ type: 'content/gridRows', package: samplePackage() });
    if (!response.ok || response.type !== 'content/rows') throw new Error('unexpected');
    const block = response.payload;
    expect(block.fromGrid).toBe(true);
    expect(block.columns.map((column) => column.column)).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal']);
    expect(block.columns.map((column) => column.heading)).toEqual(['*Container Number', 'Carrier Seal #', 'Shipper Seal #']);
    expect(block.blank).toEqual([]);
    expect(block.tsv.split('\r\n')).toEqual(['MSCU1234566\tSL-4471209\tSH-001', 'MSDU7654322\tSL-4471210\t', 'TGHU7654320\t\tSL-9']);
  });
});
