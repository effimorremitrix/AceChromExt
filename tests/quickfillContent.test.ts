/**
 * The Quickfill content script's own wiring on an INTTRA tab: what it says
 * the page is, and what it offers when it cannot say.
 *
 * jsdom's hostname is not a CBP one, so every document here is an INTTRA
 * document to the script.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickfillContentRequest, QuickfillContentResponse } from '../quickfill-extension/src/core/messages.js';
import { approveDeckhand, buildFilingPackage, type FilingPackage } from '../shared/src/index.js';
import { extractWithRules } from '../deckhand/src/index.js';

type Listener = (message: QuickfillContentRequest, sender: unknown, sendResponse: (response: QuickfillContentResponse) => void) => boolean;

const listeners: Listener[] = [];

function samplePackage(): FilingPackage {
  const shipment = extractWithRules(readFileSync(join(__dirname, 'fixtures', 'deckhand', '04-booking-confirmation.txt'), 'utf8'));
  return approveDeckhand(buildFilingPackage({ shipment, now: new Date('2026-09-14T00:00:00Z') }), new Date('2026-09-14T00:00:00Z'));
}

/** Deliver a message; `kept` is what the listener returned (true: it answers later). */
function ask(message: QuickfillContentRequest): { get: () => QuickfillContentResponse | null; kept: boolean } {
  const holder: { value: QuickfillContentResponse | null } = { value: null };
  let kept = false;
  for (const listener of listeners) {
    kept = listener(message, null, (value) => {
      holder.value = value;
    }) || kept;
  }
  return { get: () => holder.value, kept };
}

function answer(message: QuickfillContentRequest): QuickfillContentResponse {
  const sent = ask(message);
  if (!sent.get()) vi.advanceTimersByTime(200);
  const response = sent.get();
  if (!response) throw new Error('no response');
  return response;
}

describe('Quickfill content script on an INTTRA tab', () => {
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

  it('reports the grid of the fifth run, which is not a table, as the grid screen, at once', () => {
    document.body.innerHTML = readFileSync(join(__dirname, 'fixtures', 'inttra-div-grid.html'), 'utf8');
    const sent = ask({ type: 'content/where' });
    expect(sent.kept).toBe(false);
    const response = sent.get();
    if (!response?.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', label: 'Copy Container Details', isGrid: true, gridWritable: false });
    expect(response.payload.copyRowsOnly).toBeUndefined();
  });

  it('still offers Copy rows, in the default order, on an INTTRA page it cannot name', () => {
    document.body.innerHTML = '<p>Welcome</p>';
    const response = answer({ type: 'content/where' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', isGrid: false, gridWritable: false, copyRowsOnly: true });
    expect(response.payload.label).toMatch(/not identified/);
    const rows = answer({ type: 'content/gridRows', package: samplePackage() });
    if (!rows.ok || rows.type !== 'content/rows') throw new Error('unexpected');
    expect(rows.payload.fromGrid).toBe(false);
    expect(rows.payload.columns.map((column) => column.heading)).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #']);
  });

  it('refuses to fill anything on such a page', () => {
    document.body.innerHTML = '<p>Welcome</p>';
    expect(answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'shipment' }).ok).toBe(false);
    expect(answer({ type: 'content/fillGrid', package: samplePackage() }).ok).toBe(false);
  });
});
