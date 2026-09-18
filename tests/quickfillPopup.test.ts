/**
 * The popup, in jsdom.
 *
 * Quickfill's whole interface is one box, two buttons and two lines of text, so
 * "the interface works" is a small enough claim to assert directly: the box
 * reads the paste, the buttons that appear match the portal the tab is on, a
 * fill reports a count and nothing else, and a failure reports one sentence.
 *
 * `chrome` is stubbed with the three calls the popup makes. What the content
 * script does with the message is tested in tests/quickfill.test.ts against
 * real fixtures; here the transport is the subject.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickfillContentRequest, QuickfillContentResponse, StoredPaste, Where } from '../quickfill-extension/src/core/messages.js';

const email = readFileSync(join(__dirname, 'fixtures', 'deckhand', '04-booking-confirmation.txt'), 'utf8');

let place: Where;
let reply: QuickfillContentResponse;
let sent: QuickfillContentRequest[];
let session: StoredPaste | null;

/** Let the popup's boot() promises and the input debounce settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

function buttonLabels(): string[] {
  return Array.from(document.querySelectorAll('.button-row-actions .button')).map((node) => node.textContent ?? '');
}

/** The one button carrying this label, whatever its rank. */
function press(label: string): void {
  const button = Array.from(document.querySelectorAll('.button-row-actions .button')).find((node) => node.textContent === label);
  if (!button) throw new Error(`No button labelled ${label}. Buttons: ${buttonLabels().join(', ')}`);
  (button as HTMLButtonElement).click();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  place = { portal: 'ace', label: 'Step 4: Transportation', hasLines: false, isGrid: false, gridWritable: false };
  reply = { ok: true, type: 'content/count', payload: { filled: 3, total: 4, missed: ['Carrier SCAC/IATA'] } };
  sent = [];
  session = null;

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type: string; payload?: StoredPaste }) => {
        if (message.type === 'store/set') {
          session = message.payload ?? null;
          return { ok: true, type: 'store/data', payload: session };
        }
        if (message.type === 'store/clear') {
          session = null;
          return { ok: true, type: 'store/cleared' };
        }
        return { ok: true, type: 'store/data', payload: session };
      }),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async (_id: number, message: QuickfillContentRequest) => {
        sent.push(message);
        if (message.type === 'content/where') return { ok: true, type: 'content/where', payload: place };
        return reply;
      }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(): Promise<HTMLTextAreaElement> {
  await import('../quickfill-extension/src/ui/popup.js');
  await settle();
  return document.querySelector('.paste-box') as HTMLTextAreaElement;
}

async function paste(box: HTMLTextAreaElement, value: string): Promise<void> {
  box.value = value;
  box.dispatchEvent(new Event('input'));
  await settle();
}

describe('where(): the grid outranks the step strip', () => {
  // Reproduces the live portal on 2026-09-17: Copy Container Details is a
  // MODAL over another step, so the step strip behind it still reports that
  // step. On the first live run the popup said "B/L Documents" while a
  // container grid filled the screen. The shared detector now scores the grid
  // above every wording hint combined, so the popup and the INTTRA Helper's
  // panel answer the same.
  const MODAL_OVER_ANOTHER_STEP = [
    '<nav><a class="nav-link active">B/L Documents</a></nav>',
    '<div role="dialog"><h2>Copy Container Details</h2>',
    '<table><tr><th>Container Number</th><th>Carrier Seal #</th><th>Shipper Seal #</th><th>HS Code</th></tr>',
    '<tr><td><input name="r0.container" /></td><td><input name="r0.carrier" /></td><td><input name="r0.shipper" /></td><td><input name="r0.hs" /></td></tr>',
    '</table></div>',
  ].join('');

  it('reports the grid, not the step behind the modal', async () => {
    const { detectInttraPage } = await import('../inttra-extension/src/content/pageDetector.js');
    const { detectGrid } = await import('../inttra-extension/src/content/gridWriter.js');
    document.body.innerHTML = MODAL_OVER_ANOTHER_STEP;

    // The grid is present, and that is what there is to fill: the step strip
    // behind it says B/L Documents, and the detector no longer believes it.
    expect(detectGrid(document).found).toBe(true);
    const page = detectInttraPage(document);
    expect(page.page).toBe('copyContainerDetails');
    expect(page.confidence).toBe('high');
  });
});

describe('the popup', () => {
  it('renders one box and nothing to click until something is pasted', async () => {
    const box = await mount();
    expect(box).toBeTruthy();
    expect(buttonLabels()).toEqual([]);
    expect(text('.button-row')).toContain('Paste something above to fill');
  });

  it('says in one line what the paste was read as', async () => {
    const box = await mount();
    await paste(box, email);
    expect(text('.read-as')).toBe('Read as: carrier email · EBKG18531408 · 3 containers · 3 with a seal');
  });

  it('keeps the parsed paste in the session store', async () => {
    const box = await mount();
    await paste(box, email);
    expect(session?.package.header.bookingReference.value).toBe('EBKG18531408');
    expect(session?.shipment.invoice.vessel).toBe('MSC FIRENZE');
  });

  it('shows the ACE buttons on an ACE step', async () => {
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Fill this page']);
  });

  it('offers the line picker only on the Commodities step', async () => {
    place = { portal: 'ace', label: 'Step 3: Commodities', hasLines: true, isGrid: false, gridWritable: false };
    const box = await mount();
    await paste(box, ['InvoiceNumber\tDescription', 'CN-1042\tAlmond Kernels'].join('\n'));
    expect(buttonLabels()).toEqual(['Fill this page', 'Fill line']);
    expect(document.querySelector('.button-row select')).toBeTruthy();
  });

  it('shows the INTTRA buttons on an INTTRA screen', async () => {
    place = { portal: 'inttra', label: 'General Details', hasLines: false, isGrid: false, gridWritable: false };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Fill this screen', 'Fill container 1']);
  });

  it('leads with Copy rows on a grid that cannot be typed into', async () => {
    // The live portal's grid: clicking Fill first is a dead end, so it is not
    // the first button.
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: false };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows', 'Fill container grid']);
  });

  it('says before the click why Fill cannot write this grid, and does not dress it as the route', async () => {
    // The live portal, 2026-09-17: two equal blue buttons read as two equal
    // routes. Fill was pressed, wrote nothing, and only then said why. So the
    // reason is on the screen first, and only Copy rows is blue.
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: false };
    const box = await mount();
    await paste(box, email);
    expect(text('.grid-note')).toContain('opens an editor when a cell is clicked');
    expect(text('.grid-note')).toContain('write 0 cells');
    const primary = Array.from(document.querySelectorAll('.button-row-actions .button-primary')).map((node) => node.textContent);
    expect(primary).toEqual(['Copy rows']);
  });

  it('leads with Fill on a grid that can be typed into', async () => {
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: true };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Fill container grid', 'Copy rows']);
    const primary = Array.from(document.querySelectorAll('.button-row-actions .button-primary')).map((node) => node.textContent);
    expect(primary).toEqual(['Fill container grid']);
    expect(document.querySelector('.grid-note')).toBeNull();
  });

  it('names the paste route when the grid holds no writable control', async () => {
    // The live portal, 2026-09-17: Filled 0 of 9, every cell unresolved,
    // because the grid opens an editor only when a cell is clicked.
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: false };
    reply = { ok: true, type: 'content/count', payload: { filled: 0, total: 9, missed: ['9 grid cells'], useCopyRows: true } };
    const box = await mount();
    await paste(box, email);
    press('Fill container grid');
    await settle();
    expect(text('.result')).toContain('Filled 0 of 9.');
    expect(text('.result')).toContain('Use Copy rows, click the first cell, and paste.');
  });

  it('copies the rows to the clipboard in the grid\u2019s own column order', async () => {
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: false };
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => void written.push(value) },
    });
    reply = {
      ok: true,
      type: 'content/rows',
      payload: {
        tsv: 'MSCU1234566\tSL-4471209',
        rows: 3,
        width: 2,
        columns: [
          { heading: 'Container Number', column: 'ContainerNumber' },
          { heading: 'Carrier Seal #', column: 'CarrierSeal' },
        ],
        blank: [],
        fromGrid: true,
      },
    };
    const box = await mount();
    await paste(box, email);
    // Copy rows leads on this grid.
    press('Copy rows');
    await settle();
    expect(sent.some((message) => message.type === 'content/gridRows')).toBe(true);
    expect(written).toEqual(['MSCU1234566\tSL-4471209']);
    expect(text('.result')).toBe('3 row(s) copied as Container Number, Carrier Seal #. Click the first Container Number cell of the first empty row in INTTRA and paste.');
  });

  it('names the columns that stay blank after Copy rows', async () => {
    // The operator can see whether the seal is in the block before pasting,
    // which is the whole of the checking Quickfill does.
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: false };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } });
    reply = {
      ok: true,
      type: 'content/rows',
      payload: {
        tsv: 'MSCU1234566\t\tSH-001',
        rows: 3,
        width: 3,
        columns: [
          { heading: 'Container Number', column: 'ContainerNumber' },
          { heading: 'Seal Type', column: null },
          { heading: 'Shipper Seal #', column: 'ShipperSeal' },
        ],
        blank: ['Seal Type'],
        fromGrid: true,
      },
    };
    const box = await mount();
    await paste(box, email);
    press('Copy rows');
    await settle();
    expect(text('.result')).toContain('3 row(s) copied as Container Number, Seal Type, Shipper Seal #. Blank: Seal Type.');
  });

  it('offers Copy rows alone on an INTTRA screen the detector could not name', async () => {
    // The fifth live run: the grid was of a shape the detector had never been
    // shown, and the popup offered nothing. The block needs no detection.
    place = { portal: 'inttra', label: 'INTTRA screen not identified. Copy rows still copies the container block, in the default column order, for Copy Container Details.', hasLines: false, isGrid: false, gridWritable: false, copyRowsOnly: true };
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => void written.push(value) } });
    reply = {
      ok: true,
      type: 'content/rows',
      payload: {
        tsv: 'MSCU1234566\tSL-4471209\tSH-001',
        rows: 3,
        width: 3,
        columns: [
          { heading: 'Container Number', column: 'ContainerNumber' },
          { heading: 'Carrier Seal #', column: 'CarrierSeal' },
          { heading: 'Shipper Seal #', column: 'ShipperSeal' },
        ],
        blank: [],
        fromGrid: false,
      },
    };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows']);
    expect(text('.where')).toContain('not identified');
    (document.querySelector('.button-primary') as HTMLButtonElement).click();
    await settle();
    expect(written).toEqual(['MSCU1234566\tSL-4471209\tSH-001']);
    expect(text('.result')).toContain('No grid was found, so this is the default order.');
  });

  it('offers nothing on a page that is neither portal', async () => {
    place = { portal: 'none', label: 'This CBP page is not one of the four AESDirect filing steps.', hasLines: false, isGrid: false, gridWritable: false };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual([]);
    expect(text('.where')).toContain('not one of the four AESDirect filing steps');
  });

  it('reports a count, and names only the fields that did not take', async () => {
    const box = await mount();
    await paste(box, email);
    (document.querySelector('.button-primary') as HTMLButtonElement).click();
    await settle();
    expect(sent.some((message) => message.type === 'content/fillAce')).toBe(true);
    expect(text('.result')).toBe('Filled 3 of 4. Not written: Carrier SCAC/IATA.');
  });

  it('says only the count when everything took', async () => {
    reply = { ok: true, type: 'content/count', payload: { filled: 4, total: 4, missed: [] } };
    const box = await mount();
    await paste(box, email);
    (document.querySelector('.button-primary') as HTMLButtonElement).click();
    await settle();
    expect(text('.result')).toBe('Filled 4 of 4.');
  });

  it('reports a refusal in one sentence', async () => {
    reply = { ok: false, error: 'This is not one of the four AESDirect filing steps, so nothing was filled.' };
    const box = await mount();
    await paste(box, email);
    (document.querySelector('.button-primary') as HTMLButtonElement).click();
    await settle();
    expect(text('.result')).toBe('This is not one of the four AESDirect filing steps, so nothing was filled.');
  });

  it('clears the box and the session store', async () => {
    const box = await mount();
    await paste(box, email);
    expect(session).not.toBeNull();
    (document.querySelector('.button-row .button-small') as HTMLButtonElement).click();
    await settle();
    expect(box.value).toBe('');
    expect(session).toBeNull();
    expect(buttonLabels()).toEqual([]);
  });

  it('says so, and offers nothing, when the paste cannot be read', async () => {
    const box = await mount();
    await paste(box, '{ "not": "a package or an extraction" }');
    expect(text('.read-as')).not.toBe('');
    expect(buttonLabels()).toEqual([]);
  });
});
