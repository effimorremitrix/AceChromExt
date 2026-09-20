/**
 * The content script's own wiring: the F2 hotkey, the message API, and the
 * temporary field highlighting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentRequest, ContentResponse } from '../src/core/messages.js';

type Listener = (message: ContentRequest, sender: unknown, sendResponse: (response: ContentResponse) => void) => boolean;

const listeners: Listener[] = [];

function installChromeStub(): void {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
      },
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
      },
      onChanged: { addListener: () => undefined },
    },
  };
}

function ask(message: ContentRequest): ContentResponse {
  let response: ContentResponse | null = null;
  for (const listener of listeners) {
    listener(message, null, (value) => {
      response = value;
    });
  }
  if (!response) throw new Error('no response');
  return response;
}

function mountCommodities(): void {
  document.body.innerHTML = readFileSync(join(__dirname, 'fixtures', 'ace-commodities.html'), 'utf8');
}

describe('content script', () => {
  beforeEach(async () => {
    listeners.length = 0;
    installChromeStub();
    mountCommodities();
    vi.resetModules();
    await import('../src/content/aceContent.js');
  });

  it('answers a ping', () => {
    expect(ask({ type: 'content/ping' })).toMatchObject({ ok: true, type: 'content/pong' });
  });

  it('reports the detected ACE page', () => {
    const response = ask({ type: 'content/detectPage' });
    expect(response.ok && response.type === 'content/page' && response.payload.page).toBe('commodities');
  });

  it('produces a diagnostics snapshot with per-field detection', () => {
    const response = ask({ type: 'content/diagnostics' });
    expect(response.ok).toBe(true);
    if (!response.ok || response.type !== 'content/diagnostics') throw new Error('unexpected');

    const snapshot = response.payload;
    expect(snapshot.page.page).toBe('commodities');
    expect(snapshot.fields.length).toBeGreaterThan(8);

    const scheduleB = snapshot.fields.find((field) => field.key === 'ScheduleB');
    expect(scheduleB?.detection.status).toBe('FOUND');
    // The label wording was captured from the live portal; the id was not.
    expect(scheduleB?.verificationStatus).toBe('verified');
    const carrier = snapshot.fields.find((field) => field.key === 'Carrier');
    if (carrier) expect(carrier.verificationStatus).toBe('placeholder');
    // The snapshot must be serialisable: no DOM element may leak into it.
    expect(JSON.stringify(snapshot)).toContain('ScheduleB');
    expect((scheduleB?.detection as unknown as { element?: unknown }).element).toBeUndefined();

    const missing = snapshot.fields.find((field) => field.detection.status !== 'FOUND');
    if (missing) expect(missing.devtoolsHint).toBeTruthy();
  });

  it('rejects an unsupported request', () => {
    expect(ask({ type: 'content/nope' } as unknown as ContentRequest)).toMatchObject({ ok: false });
  });

  it('opens the calculator on F2 in a numeric field, and not elsewhere', () => {
    const weight = document.getElementById('commodityLines[0].shipmentWeight.stringField') as HTMLInputElement;
    weight.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(document.querySelector('#ace-helper-calculator-host')).not.toBeNull();

    // Escape closes it again.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('#ace-helper-calculator-host')).toBeNull();
  });

  it('ignores F2 when the focus is not on a writable field', () => {
    (document.getElementById('licenseCode') as HTMLSelectElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(document.querySelector('#ace-helper-calculator-host')).toBeNull();
  });

  it('ignores F2 with a modifier held', () => {
    (document.getElementById('commodityLines[0].shipmentWeight.stringField') as HTMLInputElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', ctrlKey: true, bubbles: true }));
    expect(document.querySelector('#ace-helper-calculator-host')).toBeNull();
  });

  it('never submits: no ACE control is clicked while handling a fill request', () => {
    const save = document.getElementById('saveLine') as HTMLButtonElement;
    const clicked = vi.fn();
    save.addEventListener('click', clicked);

    ask({
      type: 'content/fill',
      scope: 'commodityLine',
      line: 1,
      shipment: {
        invoice: {
          invoiceNumber: '',
          invoiceDate: '',
          customerName: '',
          billTo: '',
          billToAddress2: '',
          billToCity: '',
          billToState: '',
          billToPostalCode: '',
          billToCountry: '',
          originState: '',
          poNumber: '',
          freightTerms: '',
          paymentTerms: '',
          paymentDueDate: '',
          carrier: '',
          vessel: '',
          bookingNumber: '',
          containerNumber: '',
          sealNumber: '',
          destination: '',
        },
        commodities: [
          {
            line: 1,
            exportInformationCode: '',
            scheduleB: '0802.12.0000',
            description: 'SHELLED ALMONDS',
            quantity1: 79833,
            uom1: 'KG',
            quantity2: null,
            uom2: '',
            origin: 'D',
            valueOfGoods: 633600,
            shippingWeight: 79832,
            eccn: '',
            licenseCode: 'C33',
          },
        ],
        provenance: { invoice: {}, commodities: {} },
        source: { fileName: 't.xlsx', sheetName: 'S', importedAt: '', rowCount: 1, headers: [], unknownHeaders: [] },
      },
      settings: {
        rounding: { mode: 'decimals', decimals: 2 },
        weightDecimals: 0,
        valueDecimals: 2,
        quantityDecimals: null,
        debugMode: false,
        highlightDurationMs: 0,
        dispatchBlur: true,
        assumeWeightIsKg: true,
      },
    });

    expect(clicked).not.toHaveBeenCalled();
    expect((document.getElementById('scheduleBNumber') as HTMLInputElement).value).toBe('0802.12.0000');
  });
});

describe('highlighting', () => {
  it('marks a field, reveals it, and restores the original styling', async () => {
    document.body.innerHTML = '<input id="f" style="background-color: rgb(255, 255, 255)" />';
    const { clearAllHighlights, highlightField, revealField, MARKER_ATTRIBUTE } = await import('../src/content/highlight.js');
    const input = document.getElementById('f') as HTMLInputElement;

    highlightField(input, 'filled', 0, 'ShippingWeight');
    expect(input.getAttribute(MARKER_ATTRIBUTE)).toBe('ShippingWeight');
    expect(input.style.outline).toContain('solid');
    // The transition is inline now, not a rule in an injected stylesheet.
    expect(input.style.transition).toContain('background-color');

    input.scrollIntoView = () => undefined;
    expect(revealField('ShippingWeight')).toBe(true);
    expect(revealField('NotFilled')).toBe(false);

    clearAllHighlights();
    expect(input.hasAttribute(MARKER_ATTRIBUTE)).toBe(false);
    expect(input.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(input.style.outline).toBe('');
    expect(input.style.transition).toBe('');
  });

  /**
   * The page's stylesheets stay the page's.
   *
   * Appending a `<style>` element invalidates the document's style, and the
   * detector forces that work to run synchronously a moment later, so the
   * page's own pending font work was processed inside our stack and Chrome
   * billed the extension for it - live INTTRA reported a font of INTTRA's own
   * that fails to decode against `inttraContent.js`. Nothing here may add a
   * stylesheet to the page again.
   */
  it('adds nothing to the page stylesheets, before or after a highlight', async () => {
    document.body.innerHTML = '<input id="f" />';
    const before = document.querySelectorAll('style, link[rel="stylesheet"]').length;
    const { clearAllHighlights, highlightField, revealField } = await import('../src/content/highlight.js');
    const input = document.getElementById('f') as HTMLInputElement;
    input.scrollIntoView = () => undefined;

    highlightField(input, 'error', 0, 'Vessel');
    revealField('Vessel');
    expect(document.querySelectorAll('style, link[rel="stylesheet"]').length).toBe(before);
    expect(document.head.children.length).toBe(0);

    clearAllHighlights();
    expect(document.querySelectorAll('style, link[rel="stylesheet"]').length).toBe(before);
  });

  it('pulses through the element itself, and cancels that pulse on clear', async () => {
    document.body.innerHTML = '<input id="f" />';
    const { clearAllHighlights, highlightField, revealField } = await import('../src/content/highlight.js');
    const input = document.getElementById('f') as HTMLInputElement;
    input.scrollIntoView = () => undefined;

    // jsdom has no Web Animations, which is the branch the live browser does
    // not take; stub it to check the call this module actually makes.
    const cancelled: string[] = [];
    let keyframes: unknown = null;
    (input as unknown as { animate: unknown }).animate = (frames: unknown) => {
      keyframes = frames;
      return { cancel: () => cancelled.push('cancel') } as unknown as Animation;
    };

    highlightField(input, 'warning', 0, 'PortOfLoading');
    revealField('PortOfLoading');
    expect(keyframes).toEqual([{ outlineOffset: '0px' }, { outlineOffset: '4px' }, { outlineOffset: '0px' }]);

    clearAllHighlights();
    expect(cancelled).toEqual(['cancel']);
  });

  it('still highlights where the browser has no Web Animations at all', async () => {
    document.body.innerHTML = '<input id="f" />';
    const { highlightField, revealField, MARKER_ATTRIBUTE } = await import('../src/content/highlight.js');
    const input = document.getElementById('f') as HTMLInputElement;
    input.scrollIntoView = () => undefined;
    expect(typeof input.animate).not.toBe('function');

    highlightField(input, 'error', 0, 'Voyage');
    // No pulse, and no throw: the outline and the scroll still say which field.
    expect(revealField('Voyage')).toBe(true);
    expect(input.getAttribute(MARKER_ATTRIBUTE)).toBe('Voyage');
    expect(input.style.outline).toContain('solid');
  });
});
