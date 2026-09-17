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
  return Array.from(document.querySelectorAll('.button-row .button-primary')).map((node) => node.textContent ?? '');
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  place = { portal: 'ace', label: 'Step 4: Transportation', hasLines: false, isGrid: false };
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
    expect(text('.read-as')).toBe('Read as: carrier email · EBKG18531408 · 3 containers');
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
    place = { portal: 'ace', label: 'Step 3: Commodities', hasLines: true, isGrid: false };
    const box = await mount();
    await paste(box, ['InvoiceNumber\tDescription', 'CN-1042\tAlmond Kernels'].join('\n'));
    expect(buttonLabels()).toEqual(['Fill this page', 'Fill line']);
    expect(document.querySelector('.button-row select')).toBeTruthy();
  });

  it('shows the INTTRA buttons on an INTTRA screen', async () => {
    place = { portal: 'inttra', label: 'General Details', hasLines: false, isGrid: false };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Fill this screen', 'Fill container 1']);
  });

  it('shows one button on the container grid', async () => {
    place = { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true };
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Fill container grid']);
  });

  it('offers nothing on a page that is neither portal', async () => {
    place = { portal: 'none', label: 'This CBP page is not one of the four AESDirect filing steps.', hasLines: false, isGrid: false };
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
