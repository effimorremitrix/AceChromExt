// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://ship.inttra.e2open.com/siact/siworkspace" }

/**
 * The Quickfill content script's own wiring on an INTTRA tab: what it says
 * the page is, and what it offers when it cannot say.
 *
 * The document is served from the live INTTRA hostname (the environment
 * options above), so the script takes every page here for an INTTRA one; the
 * playground's file-on-disk case is tests/quickfillPlayground.test.ts.
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

// Every describe in this file drives the same freshly imported content
// script, so the setup is file-scoped: a block that forgot it would otherwise
// answer through a listener left behind by the previous one.
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

describe('Quickfill content script on an INTTRA tab', () => {
  it('reports the grid of the fifth run, which is not a table, as the grid screen, at once', () => {
    document.body.innerHTML = readFileSync(join(__dirname, 'fixtures', 'inttra-div-grid.html'), 'utf8');
    const sent = ask({ type: 'content/where', mode: 'auto' });
    expect(sent.kept).toBe(false);
    const response = sent.get();
    if (!response?.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', label: 'Copy Container Details', canFillForm: false, hasGrid: true, gridWritable: false });
  });

  it('still offers Copy rows, in the default order, on an INTTRA page it cannot name', () => {
    document.body.innerHTML = '<p>Welcome</p>';
    const response = answer({ type: 'content/where', mode: 'auto' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', canFillForm: false, hasGrid: false, gridWritable: false });
    expect(response.payload.label).toMatch(/not identified/);
    const rows = answer({ type: 'content/gridRows', package: samplePackage() });
    if (!rows.ok || rows.type !== 'content/rows') throw new Error('unexpected');
    expect(rows.payload.fromGrid).toBe(false);
    expect(rows.payload.columns.map((column) => column.heading)).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #']);
  });

  it('refuses to fill anything on such a page', () => {
    document.body.innerHTML = '<p>Welcome</p>';
    expect(answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'shipment', mode: 'auto' }).ok).toBe(false);
    expect(answer({ type: 'content/fillGrid', package: samplePackage() }).ok).toBe(false);
  });
});

/**
 * Both page types reachable from one paste, which is the whole parity claim.
 *
 * The INTTRA Helper reaches the per-container blocks and the Copy Container
 * Details grid from two tabs that are always there. Quickfill used to read
 * "is this the grid screen?" off `detectInttraPage`, which returns ONE screen
 * - and on the live create page with the modal open it returns the create
 * page, because `#generalDetails` is a real, visible marker worth 10 plus its
 * heading and URL against the grid's 10. So the grid was on the screen and the
 * popup had no route to it at all.
 */
describe('Quickfill on the create page with the container grid over it', () => {
  /** The live shape: the create page (visible `#generalDetails`) with the modal's grid drawn over it. */
  function liveCreatePageWithModal(): void {
    const create = readFileSync(join(__dirname, 'fixtures', 'inttra-create-si.html'), 'utf8').replace('id="si-create"', 'id="generalDetails"');
    document.body.innerHTML = create + readFileSync(join(__dirname, 'fixtures', 'inttra-div-grid.html'), 'utf8');
  }

  it('is still named the create page by the detector, which is why one branch was not enough', async () => {
    liveCreatePageWithModal();
    const { detectInttraPage } = await import('../inttra-extension/src/content/pageDetector.js');
    const { detectGrid } = await import('../inttra-extension/src/content/gridWriter.js');
    expect(detectInttraPage(document).page).toBe('generalDetails');
    expect(detectGrid(document).found).toBe(true);
  });

  it('reports both routes', () => {
    liveCreatePageWithModal();
    const response = answer({ type: 'content/where', mode: 'auto' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', label: 'Create Shipping Instruction', canFillForm: true, hasGrid: true });
  });

  it('fills the container blocks on it', () => {
    liveCreatePageWithModal();
    const response = answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'container', mode: 'auto' });
    if (!response.ok || response.type !== 'content/count') throw new Error('unexpected');
    expect(response.payload.filled).toBeGreaterThan(0);
    expect(response.payload.assumedScreen).toBeUndefined();
    expect((document.querySelector('#cont-num-1') as HTMLInputElement).value).toBe('MSCU1234566');
    expect((document.querySelector('#carr-seal-1') as HTMLInputElement).value).toBe('SL-4471209');
  });

  it('copies the grid block from the same page, without the screen being named the grid', () => {
    liveCreatePageWithModal();
    const rows = answer({ type: 'content/gridRows', package: samplePackage() });
    if (!rows.ok || rows.type !== 'content/rows') throw new Error('unexpected');
    expect(rows.payload.fromGrid).toBe(true);
    expect(rows.payload.columns.map((column) => column.heading)).toContain('Container Number');
  });

  it('accepts a grid fill on it rather than refusing because the screen is called something else', () => {
    liveCreatePageWithModal();
    expect(answer({ type: 'content/fillGrid', package: samplePackage() }).ok).toBe(true);
  });
});

/**
 * The toggle, pinned to INTTRA.
 *
 * A fill has to aim at some mapping table, and guessing one silently is not
 * the helper's call - which is why an unidentified screen was refused while
 * the toggle did not exist. Pinning is the operator making that call, so the
 * create page's fields are tried and the answer names the assumption.
 */
describe('Quickfill pinned to INTTRA on a screen nothing identifies', () => {
  /** The container block alone: the captured ids, and nothing any signature scores on. */
  const BARE_CONTAINER_BLOCK = [
    '<div><input type="text" id="cont-num-1" name="cont-num-1" maxlength="11" aria-label="Container Number" />',
    '<input type="text" id="carr-seal-1" name="carr-seal-1" maxlength="79" aria-label="Carrier Seal Number(s)" />',
    '<input type="text" id="ship-seal-1" name="ship-seal-1" maxlength="79" aria-label="Shipper Seal Number(s)" /></div>',
  ].join('');

  it('still refuses in Auto, because nobody chose the screen', () => {
    document.body.innerHTML = BARE_CONTAINER_BLOCK;
    expect(answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'container', mode: 'auto' }).ok).toBe(false);
  });

  it('fills the container block, and names the screen it assumed', () => {
    document.body.innerHTML = BARE_CONTAINER_BLOCK;
    const response = answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'container', mode: 'inttra' });
    if (!response.ok || response.type !== 'content/count') throw new Error('unexpected');
    expect(response.payload.assumedScreen).toBe('Create Shipping Instruction');
    expect((document.querySelector('#cont-num-1') as HTMLInputElement).value).toBe('MSCU1234566');
  });

  it('says before the click that the create page is what it will write', () => {
    document.body.innerHTML = BARE_CONTAINER_BLOCK;
    const response = answer({ type: 'content/where', mode: 'inttra' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', canFillForm: true, assumingCreatePage: true });
    expect(response.payload.label).toContain('Create Shipping Instruction');
  });
});

/**
 * The pin is not a licence to write into the other portal.
 *
 * INTTRA's ladders match by label wording, and an ACE step carries wordings
 * that brush against them - "Vessel", "Booking Number". A toggle left on
 * INTTRA while the operator moves to an AESDirect step would otherwise aim
 * those ladders at ACE's form and type INTTRA's values into ACE's boxes. So a
 * named AESDirect step is never treated as an unidentified INTTRA screen.
 */
describe('a mis-set toggle', () => {
  const ACE_STEP = readFileSync(join(__dirname, 'fixtures', 'ace-transportation.html'), 'utf8');

  it('refuses a pinned INTTRA fill on an AESDirect step, and names the step', () => {
    document.body.innerHTML = ACE_STEP;
    const response = answer({ type: 'content/fillInttra', package: samplePackage(), scope: 'shipment', mode: 'inttra' });
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unexpected');
    expect(response.error).toContain('an AESDirect step');
  });

  it('offers no fill there either, only the clipboard block', () => {
    document.body.innerHTML = ACE_STEP;
    const response = answer({ type: 'content/where', mode: 'inttra' });
    if (!response.ok || response.type !== 'content/where') throw new Error('unexpected');
    expect(response.payload).toMatchObject({ portal: 'inttra', canFillForm: false, hasGrid: false });
    expect(response.payload.assumingCreatePage).toBeUndefined();
  });
});
