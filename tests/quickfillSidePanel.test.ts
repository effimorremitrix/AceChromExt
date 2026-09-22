/**
 * The Quickfill side panel, in jsdom.
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

import type { FillMode, Portal, QuickfillContentRequest, QuickfillContentResponse, StoredPaste, Where } from '../quickfill-extension/src/core/messages.js';

const email = readFileSync(join(__dirname, 'fixtures', 'deckhand', '04-booking-confirmation.txt'), 'utf8');

let place: Where;
let reply: QuickfillContentResponse;
let sent: QuickfillContentRequest[];
let session: StoredPaste | null;
let sessionMode: FillMode;
/** Whether the content script is in the tab. False is a tab that was open before the helper was loaded. */
let running: boolean;
/** Whether Chrome lets the popup start it. False is a page that refuses the injection. */
let injectionWorks: boolean;
/** What `chrome.tabs.query` reports; undefined is a tab this extension has no host permission for. */
let tabUrl: string | undefined;
let injected: string[][];
/** Every `chrome.tabs.query` the surface made, so a detached one can be shown to skip its own window. */
let queries: Record<string, unknown>[];
/** Every window the surface asked Chrome to open. Should stay empty: there is no Pop out. */
let opened: Record<string, unknown>[];
/** The browser-event listeners `watchBrowser` subscribed, so a test can fire one. */
let hooks: { activated: Array<(...args: unknown[]) => void>; updated: Array<(...args: unknown[]) => void>; focus: Array<(...args: unknown[]) => void> };

/**
 * What the tab answers. `canFillForm` defaults to true for a named portal,
 * because that is the common case; the grid screen passes it false, since
 * Copy Container Details has no fields of its own.
 */
function at(portal: Portal, label: string, extra: Partial<Where> = {}): Where {
  return { portal, label, hasLines: false, canFillForm: portal !== 'none', hasGrid: false, gridWritable: false, ...extra };
}

/** The labels on the portal toggle, and which one is pressed. */
function modeLabels(): string[] {
  return Array.from(document.querySelectorAll('.mode-button')).map((node) => node.textContent ?? '');
}

function activeMode(): string {
  return document.querySelector('.mode-button-active')?.textContent ?? '';
}

function pressMode(label: string): void {
  const button = Array.from(document.querySelectorAll('.mode-button')).find((node) => node.textContent === label);
  if (!button) throw new Error(`No mode button labelled ${label}`);
  (button as HTMLButtonElement).click();
}

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
  place = at('ace', 'Step 4: Transportation');
  reply = { ok: true, type: 'content/count', payload: { filled: 3, total: 4, missed: ['Carrier SCAC/IATA'] } };
  sent = [];
  session = null;
  sessionMode = 'auto';
  running = true;
  injectionWorks = true;
  tabUrl = 'https://aesdirect.cbp.dhs.gov/filing';
  injected = [];
  queries = [];
  opened = [];
  hooks = { activated: [], updated: [], focus: [] };

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async (message: { type: string; payload?: StoredPaste; mode?: FillMode }) => {
        if (message.type === 'store/set') {
          session = message.payload ?? null;
          return { ok: true, type: 'store/data', payload: { paste: session, mode: sessionMode } };
        }
        if (message.type === 'store/mode') {
          sessionMode = message.mode ?? 'auto';
          return { ok: true, type: 'store/data', payload: { paste: session, mode: sessionMode } };
        }
        if (message.type === 'store/clear') {
          session = null;
          return { ok: true, type: 'store/cleared' };
        }
        return { ok: true, type: 'store/data', payload: { paste: session, mode: sessionMode } };
      }),
    },
    tabs: {
      // Chrome populates `url` only for a tab the extension has host
      // permission for, which is how the popup tells a portal tab it cannot
      // talk to from a tab it may not touch at all.
      query: vi.fn(async (query: Record<string, unknown>) => {
        queries.push(query);
        return [tabUrl === undefined ? { id: 7 } : { id: 7, url: tabUrl }];
      }),
      // A side panel stays open while the operator moves around the browser, so
      // it subscribes to these and re-asks the page. See src/ui/liveTab.ts.
      onActivated: { addListener: (fn: (...args: unknown[]) => void) => hooks.activated.push(fn) },
      onUpdated: { addListener: (fn: (...args: unknown[]) => void) => hooks.updated.push(fn) },
      sendMessage: vi.fn(async (_id: number, message: QuickfillContentRequest) => {
        // What Chrome throws when no frame in the tab is listening.
        if (!running) throw new Error('Could not establish connection. Receiving end does not exist.');
        sent.push(message);
        if (message.type === 'content/where') return { ok: true, type: 'content/where', payload: place };
        return reply;
      }),
    },
    windows: {
      onFocusChanged: { addListener: (fn: (...args: unknown[]) => void) => hooks.focus.push(fn) },
      // Still stubbed so a re-introduced Pop out would be caught rather than throw.
      create: vi.fn(async (options: Record<string, unknown>) => {
        opened.push(options);
        return { id: 99 };
      }),
    },
    scripting: {
      executeScript: vi.fn(async ({ files }: { target: { tabId: number; allFrames?: boolean }; files: string[] }) => {
        injected.push(files);
        if (!injectionWorks) throw new Error('Cannot access contents of the page.');
        running = true;
        return [];
      }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(): Promise<HTMLTextAreaElement> {
  await import('../quickfill-extension/src/ui/sidePanel.js');
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
    place = at('ace', 'Step 3: Commodities', { hasLines: true });
    const box = await mount();
    await paste(box, ['InvoiceNumber\tDescription', 'CN-1042\tAlmond Kernels'].join('\n'));
    expect(buttonLabels()).toEqual(['Fill this page', 'Fill line']);
    expect(document.querySelector('.button-row select')).toBeTruthy();
  });

  it('shows the INTTRA buttons on an INTTRA screen', async () => {
    place = at('inttra', 'General Details');
    const box = await mount();
    await paste(box, email);
    // One press per screen: the number of containers differs per draft, so the
    // button walks every container block rather than naming one. Copy rows
    // trails, because it needs no grid to build the block and the operator's
    // next move on this screen is to open the modal and paste it.
    expect(buttonLabels()).toEqual(['Fill this screen', 'Fill all 3 containers', 'Copy rows']);
  });

  it('leads with Copy rows on a grid that cannot be typed into', async () => {
    // The live portal's grid: clicking Fill first is a dead end, so it is not
    // the first button.
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows', 'Fill container grid']);
  });

  it('says before the click why Fill cannot write this grid, and does not dress it as the route', async () => {
    // The live portal, 2026-09-17: two equal blue buttons read as two equal
    // routes. Fill was pressed, wrote nothing, and only then said why. So the
    // reason is on the screen first, and only Copy rows is blue.
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
    const box = await mount();
    await paste(box, email);
    expect(text('.grid-note')).toContain('opens an editor when a cell is clicked');
    expect(text('.grid-note')).toContain('write 0 cells');
    const primary = Array.from(document.querySelectorAll('.button-row-actions .button-primary')).map((node) => node.textContent);
    expect(primary).toEqual(['Copy rows']);
  });

  it('leads with Fill on a grid that can be typed into', async () => {
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true, gridWritable: true });
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
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
    reply = { ok: true, type: 'content/count', payload: { filled: 0, total: 9, missed: ['9 grid cells'], useCopyRows: true } };
    const box = await mount();
    await paste(box, email);
    press('Fill container grid');
    await settle();
    expect(text('.result')).toContain('Filled 0 of 9.');
    expect(text('.result')).toContain('Use Copy rows, click the first cell, and paste.');
  });

  it('copies the rows to the clipboard in the grid\u2019s own column order', async () => {
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
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
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
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
    place = at('inttra', 'INTTRA screen not identified. Copy rows still copies the container block, in the default column order, for Copy Container Details.', { canFillForm: false });
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
    place = at('none', 'This CBP page is not one of the four AESDirect filing steps.');
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

/**
 * Both INTTRA page types, from one paste.
 *
 * The INTTRA Helper reaches the form and the grid from two tabs that are
 * always there. Quickfill has one row of buttons, so it has to offer both
 * routes whenever both exist - and on the live create page with the Copy
 * Container Details modal open, both do: `detectInttraPage` names the create
 * page there (the marker `#generalDetails` is real, visible and worth 10, plus
 * its heading and URL, against the grid's 10), while the grid is on the screen
 * all the same. Reading "is this the grid screen?" off that one answer left
 * the popup with no grid route at all.
 */
describe('the two INTTRA page types', () => {
  it('offers the grid AND the container blocks when the modal is open over the create page', async () => {
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true, hasGrid: true, gridWritable: false });
    const box = await mount();
    await paste(box, email);
    // The grid pair leads, because the modal is what the operator is looking
    // at, and Copy rows leads it because this grid cannot be typed into.
    expect(buttonLabels()).toEqual(['Copy rows', 'Fill container grid', 'Fill this screen', 'Fill all 3 containers']);
    const primary = Array.from(document.querySelectorAll('.button-row-actions .button-primary')).map((node) => node.textContent);
    expect(primary).toEqual(['Copy rows']);
  });

  it('keeps the form buttons first when no grid is on the page', async () => {
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true, hasGrid: false });
    const box = await mount();
    await paste(box, email);
    // Copy rows still trails: the operator opens the modal next, and the block
    // needs no grid to be built.
    expect(buttonLabels()).toEqual(['Fill this screen', 'Fill all 3 containers', 'Copy rows']);
  });

  it('offers the grid on an INTTRA page the detector could not name', async () => {
    // A tie no signature won, with the grid on the screen: the INTTRA Helper
    // has a checkbox for exactly this ("look for the grid even when the screen
    // was not identified"), and here it needs none.
    place = at('inttra', 'INTTRA screen not identified, but a container grid is on the page, so the grid can still be filled and copied.', {
      canFillForm: false,
      hasGrid: true,
    });
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows', 'Fill container grid']);
  });

  it('sends the container fill with no index, so one press walks every block', async () => {
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true });
    const box = await mount();
    await paste(box, email);
    press('Fill all 3 containers');
    await settle();
    const fill = sent.find((message) => message.type === 'content/fillInttra' && message.scope === 'container');
    expect(fill).toMatchObject({ type: 'content/fillInttra', scope: 'container', mode: 'auto' });
    expect(fill && 'containerIndex' in fill ? fill.containerIndex : undefined).toBeUndefined();
  });
});

/**
 * A tab the popup cannot talk to.
 *
 * The live run on 2026-09-21: the operator rebuilt the helper, pressed Reload
 * on chrome://extensions, and opened the popup over an INTTRA create page that
 * had been open the whole time - with the Copy Container Details grid on the
 * screen and seven containers in the box. Chrome injects a content script when
 * a page LOADS, so that tab was running nothing, and the popup answered
 * "Quickfill is not running in this tab. Open an ACE or INTTRA screen and
 * reload the page" over a second line telling the operator to open the screen
 * they were already looking at. Every route was withdrawn, Copy rows included,
 * although the block it copies needs nothing from the page at all.
 */
describe('a tab that is not running the helper', () => {
  function clipboard(): string[] {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => void written.push(value) } });
    return written;
  }

  it('starts the content script itself, rather than asking for a page reload', async () => {
    running = false;
    const box = await mount();
    await paste(box, email);
    expect(injected).toEqual([['quickfillContent.js']]);
    // Recovered: the tab answered the retry, so the ordinary buttons are back
    // and no modal was closed to get them.
    expect(buttonLabels()).toEqual(['Fill this page']);
    expect(text('.where')).toBe('Step 4: Transportation');
  });

  it('injects nothing into a tab that answers', async () => {
    const box = await mount();
    await paste(box, email);
    expect(injected).toEqual([]);
  });

  it('keeps Copy rows when the tab cannot be started, because the block needs no page', async () => {
    // A portal tab where the injection is refused: whatever else is lost, the
    // container block is not, and it goes out in the default column order,
    // which is the order the live grid was read in on 2026-09-20.
    running = false;
    injectionWorks = false;
    place = at('inttra', 'Copy Container Details', { canFillForm: false, hasGrid: true });
    const written = clipboard();
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows']);
    expect(text('.where')).toContain('Quickfill could not start in this tab');
    expect(text('.grid-note')).toContain('Copy rows still copies the container block');
    press('Copy rows');
    await settle();
    expect(written).toHaveLength(1);
    expect(written[0]?.split('\r\n')).toHaveLength(3);
    expect(text('.result')).toContain('3 row(s) copied as Container Number, Carrier Seal #, Shipper Seal #.');
    expect(text('.result')).toContain('Quickfill is not running in this tab, so the grid could not be read and this is the default order.');
  });

  it('never tells the operator to open the screen they are already on', async () => {
    running = false;
    injectionWorks = false;
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true, hasGrid: true });
    const box = await mount();
    await paste(box, email);
    expect(document.body.textContent).not.toContain('Open an ACE or INTTRA screen in this tab.');
  });

  it('says a tab it has no permission for is not a portal, and does not try to inject into it', async () => {
    // No `url` from chrome.tabs.query means no host permission for this tab.
    // Reloading it would change nothing, so the popup does not suggest it.
    running = false;
    tabUrl = undefined;
    const box = await mount();
    await paste(box, email);
    expect(injected).toEqual([]);
    expect(text('.where')).toContain('not an ACE or INTTRA screen');
    expect(buttonLabels()).toEqual([]);
    expect(text('.button-row-actions')).toContain('Open an ACE or INTTRA screen in this tab.');
  });

  it('offers the route again as soon as the tab answers', async () => {
    // The operator reloads the page with the popup still open: the next press
    // finds the tab and the popup stops apologising.
    running = false;
    injectionWorks = false;
    const box = await mount();
    await paste(box, email);
    expect(buttonLabels()).toEqual(['Copy rows']);
    running = true;
    pressMode('ACE');
    await settle();
    expect(buttonLabels()).toEqual(['Fill this page']);
  });
});

/**
 * The portal toggle.
 *
 * Auto is the default and is what the popup did before the toggle existed.
 * The pins are for the operator who can see the portal when the detector
 * cannot - the third live run read "INTTRA screen not identified" and blocked
 * Fill on the page being filled.
 */
describe('the ACE / INTTRA toggle', () => {
  it('offers three states, and starts on Auto', async () => {
    await mount();
    expect(modeLabels()).toEqual(['Auto', 'ACE', 'INTTRA']);
    expect(activeMode()).toBe('Auto');
  });

  it('asks the tab again, as the pinned portal, and keeps the pin for the session', async () => {
    const box = await mount();
    await paste(box, email);
    sent = [];
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true });
    pressMode('INTTRA');
    await settle();
    expect(activeMode()).toBe('INTTRA');
    expect(sent.filter((message) => message.type === 'content/where')).toEqual([{ type: 'content/where', mode: 'inttra' }]);
    expect(sessionMode).toBe('inttra');
    expect(buttonLabels()).toEqual(['Fill this screen', 'Fill all 3 containers', 'Copy rows']);
  });

  it('carries the pin into the fill, so an unidentified screen is filled rather than refused', async () => {
    place = at('inttra', 'INTTRA screen not identified. Set to INTTRA, so Fill writes the Create Shipping Instruction fields.', {
      canFillForm: true,
      assumingCreatePage: true,
    });
    sessionMode = 'inttra';
    const box = await mount();
    await paste(box, email);
    expect(activeMode()).toBe('INTTRA');
    press('Fill this screen');
    await settle();
    expect(sent.some((message) => message.type === 'content/fillInttra' && message.mode === 'inttra')).toBe(true);
  });

  it('names the screen it assumed, before it says how many took', async () => {
    place = at('inttra', 'INTTRA screen not identified.', { canFillForm: true, assumingCreatePage: true });
    sessionMode = 'inttra';
    reply = { ok: true, type: 'content/count', payload: { filled: 2, total: 7, missed: [], assumedScreen: 'Create Shipping Instruction' } };
    const box = await mount();
    await paste(box, email);
    press('Fill this screen');
    await settle();
    expect(text('.result')).toBe('The screen was not identified, so the Create Shipping Instruction fields were tried. Filled 2 of 7.');
  });

  it('says plainly when the pinned portal is not what this page is', async () => {
    place = at('none', 'Set to ACE, and this page is not one of the four AESDirect filing steps, so there is nothing here to fill. Switch to Auto or INTTRA, or open an AESDirect step.');
    sessionMode = 'ace';
    const box = await mount();
    await paste(box, email);
    expect(activeMode()).toBe('ACE');
    expect(buttonLabels()).toEqual([]);
    expect(text('.where')).toContain('Set to ACE');
  });

  it('survives Clear: emptying the box does not un-pin the portal', async () => {
    sessionMode = 'inttra';
    place = at('inttra', 'Create Shipping Instruction', { canFillForm: true });
    const box = await mount();
    await paste(box, email);
    (document.querySelector('.button-row .button-small') as HTMLButtonElement).click();
    await settle();
    expect(box.value).toBe('');
    expect(sessionMode).toBe('inttra');
    expect(activeMode()).toBe('INTTRA');
  });
});

/**
 * The surface itself.
 *
 * This file has tracked one complaint through three answers. The original:
 * leave an ACE or INTTRA screen with the helper open, come back, and it is
 * gone; the toolbar icon has to be clicked again. That is Chrome, not a bug
 * here - an action popup is destroyed the moment it loses focus, and on a
 * container grid that is every click into the grid.
 *
 * First answer, 2026-09-22 morning: a "Pop out" button reopening this page as
 * a floating window. Second, the same afternoon: drop the popup and the window
 * both, and open the side panel the other two helpers open. One box needs no
 * docked strip, which is why Quickfill held out; what decided it is that three
 * helpers behaving three ways is one thing more to remember than a forwarder
 * in a hurry has room for.
 *
 * What is pinned here is what an operator would notice if either half of that
 * were undone: no Pop out button, and the tab read the way a docked surface
 * reads it.
 */
describe('the side panel', () => {
  /** Any button on the screen, not only the fill row. */
  function anyButton(label: string): HTMLButtonElement | null {
    const match = Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label);
    return (match ?? null) as HTMLButtonElement | null;
  }

  it('offers no Pop out button, because there is no popup left to escape', async () => {
    await mount();

    expect(anyButton('Pop out')).toBeNull();
    // The window it opened is gone with it: nothing here creates one.
    expect(opened).toEqual([]);
  });

  it('reads the active tab of its own window, the way a docked surface should', async () => {
    await mount();

    // A side panel is docked INSIDE the browser window whose page it fills, so
    // `currentWindow` means the portal. The pop-out window had to ask for
    // `windowType: 'normal'` instead, because `currentWindow` meant itself.
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query['currentWindow']).toBe(true);
      expect(query['windowType']).toBeUndefined();
    }
  });

  it('re-asks the page when the operator moves around the browser', async () => {
    // A popup was destroyed before the page could change under it. A panel is
    // still on screen when the operator switches to the ACE tab or reloads the
    // portal, and a stale "Copy Container Details, 7 containers" reads as
    // current.
    await mount();
    const before = sent.filter((message) => message.type === 'content/where').length;
    expect(before).toBeGreaterThan(0);

    place = at('inttra', 'Create Shipping Instruction');
    hooks.activated[0]?.({ tabId: 7 });
    await settle();
    await settle();

    expect(sent.filter((message) => message.type === 'content/where').length).toBeGreaterThan(before);
  });

  it('opens on the paste it was holding, carried in session storage', async () => {
    const { isFailure, parsePaste } = await import('../quickfill-extension/src/paste.js');
    const parsed = parsePaste(email);
    if (isFailure(parsed)) throw new Error(parsed.error);
    session = { text: email, summary: parsed.summary, package: parsed.pkg, shipment: parsed.ace };

    await mount();

    expect((document.querySelector('.paste-box') as HTMLTextAreaElement).value).toBe(email);
    expect(text('.read-as')).toContain(parsed.summary);
  });
});
