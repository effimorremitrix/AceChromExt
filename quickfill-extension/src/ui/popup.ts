/**
 * The whole interface: a box, two buttons, two lines of text.
 *
 * There is no panel, no side panel, no options page, no tab strip and no
 * settings screen. The ACE Helper's panel has eight tabs because it answers
 * "where did this value come from?"; Quickfill answers "is it in the field?",
 * and the operator answers that by looking at the form.
 *
 * Built with createElement and textContent only, so nothing pasted can ever be
 * interpreted as markup.
 */

import { appendAll, clear, el } from '../../../src/ui/dom.js';
import { isFailure, parsePaste } from '../paste.js';
import type {
  FillCount,
  QuickfillBackgroundRequest,
  QuickfillBackgroundResponse,
  QuickfillContentRequest,
  QuickfillContentResponse,
  StoredPaste,
  Where,
} from '../core/messages.js';
import { CONTENT_NOT_READY } from '../core/messages.js';

let stored: StoredPaste | null = null;
let place: Where = { portal: 'none', label: 'Looking...', hasLines: false, isGrid: false };

const box = el('textarea', {
  className: 'paste-box',
  attrs: { placeholder: 'Paste the carrier email, a filing-package.json, or spreadsheet rows.', spellcheck: 'false' },
});
const readAs = el('p', { className: 'read-as' });
const whereLine = el('p', { className: 'where' });
const result = el('p', { className: 'result' });
const buttons = el('div', { className: 'button-row' });
const lineSelect = el('select', { className: 'select' });

async function toBackground(message: QuickfillBackgroundRequest): Promise<QuickfillBackgroundResponse> {
  return (await chrome.runtime.sendMessage(message)) as QuickfillBackgroundResponse;
}

async function toContent(message: QuickfillContentRequest): Promise<QuickfillContentResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab.' };
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as QuickfillContentResponse;
  } catch {
    return { ok: false, error: CONTENT_NOT_READY };
  }
}

function say(text: string, tone: 'plain' | 'error' = 'plain'): void {
  result.textContent = text;
  result.className = tone === 'error' ? 'result read-as-error' : 'result';
}

/** The one line of feedback a fill produces. */
function report(count: FillCount): void {
  if (count.total === 0) {
    say('Nothing on this screen is mapped to a value in the paste.');
    return;
  }
  const head = `Filled ${count.filled} of ${count.total}.`;
  if (count.useCopyRows) {
    // Nothing took because the grid holds no writable control until a cell is
    // clicked. Saying "0 of 9" and stopping would leave the operator stuck in
    // front of a screen that does have a way in.
    clear(result);
    result.className = 'result';
    appendAll(
      result,
      head,
      ' ',
      el('span', { className: 'result-detail', text: 'This grid opens an editor when a cell is clicked, so there is nothing to type into. Use Copy rows, click the first cell, and paste.' }),
    );
    return;
  }
  if (!count.missed.length) {
    say(head);
    return;
  }
  clear(result);
  result.className = 'result';
  appendAll(result, head, ' ', el('span', { className: 'result-detail', text: `Not written: ${count.missed.join(', ')}.` }));
}

/**
 * Put the containers on the clipboard as the grid's own columns.
 *
 * Copy Container Details is the screen INTTRA built for pasting a block of
 * rows, so this is not a workaround: it is the screen used as intended, and it
 * needs no selector for the cell editors. The content script produces the rows
 * because only it can see the grid, and therefore its column order.
 */
async function copyRows(pkg: StoredPaste['package']): Promise<void> {
  const response = await toContent({ type: 'content/gridRows', package: pkg });
  if (!response.ok) {
    say(response.error, 'error');
    return;
  }
  if (response.type !== 'content/rows') return;
  try {
    await navigator.clipboard.writeText(response.payload.tsv);
    say(`${response.payload.rows} row(s) copied. Click the first cell of the first empty row in INTTRA and paste.`);
  } catch {
    say('Could not write to the clipboard.', 'error');
  }
}

/** Read the box, keep the result, and say in one line what it was read as. */
async function readBox(): Promise<void> {
  const text = box.value;
  if (text.trim() === '') {
    stored = null;
    readAs.className = 'read-as';
    readAs.textContent = '';
    await toBackground({ type: 'store/clear' });
    renderButtons();
    return;
  }
  const parsed = parsePaste(text);
  if (isFailure(parsed)) {
    stored = null;
    readAs.className = 'read-as read-as-error';
    readAs.textContent = parsed.error;
    renderButtons();
    return;
  }
  stored = { text, summary: parsed.summary, package: parsed.pkg, shipment: parsed.ace };
  readAs.className = 'read-as';
  readAs.textContent = `Read as: ${parsed.summary}`;
  await toBackground({ type: 'store/set', payload: stored });
  renderLines();
  renderButtons();
}

/** The line picker, shown only on the Commodities step and only with lines to pick. */
function renderLines(): void {
  clear(lineSelect);
  const lines = stored?.shipment.commodities ?? [];
  for (const commodity of lines) {
    lineSelect.append(el('option', { text: `Line ${commodity.line}`, attrs: { value: String(commodity.line) } }));
  }
}

function fillButton(label: string, run: () => Promise<void>): HTMLButtonElement {
  const button = el('button', { className: 'button button-primary', text: label });
  button.addEventListener('click', () => {
    button.disabled = true;
    void run().finally(() => {
      button.disabled = false;
    });
  });
  return button;
}

async function run(message: QuickfillContentRequest): Promise<void> {
  const response = await toContent(message);
  if (!response.ok) {
    say(response.error, 'error');
    return;
  }
  if (response.type === 'content/count') report(response.payload);
}

function renderButtons(): void {
  clear(buttons);
  whereLine.textContent = place.label;

  if (!stored) {
    buttons.append(el('span', { className: 'where', text: 'Paste something above to fill.' }));
    return;
  }

  if (place.portal === 'ace') {
    const shipment = stored.shipment;
    buttons.append(fillButton('Fill this page', () => run({ type: 'content/fillAce', shipment, scope: 'shipment' })));
    if (place.hasLines && shipment.commodities.length) {
      buttons.append(
        fillButton('Fill line', () =>
          run({ type: 'content/fillAce', shipment, scope: 'commodityLine', line: Number(lineSelect.value) || 1 }),
        ),
        lineSelect,
      );
    }
    return;
  }

  if (place.portal === 'inttra') {
    const pkg = stored.package;
    if (place.isGrid) {
      buttons.append(
        fillButton('Fill container grid', () => run({ type: 'content/fillGrid', package: pkg })),
        fillButton('Copy rows', () => copyRows(pkg)),
      );
      return;
    }
    buttons.append(fillButton('Fill this screen', () => run({ type: 'content/fillInttra', package: pkg, scope: 'shipment' })));
    if (pkg.containers.length) {
      buttons.append(
        fillButton('Fill container 1', () => run({ type: 'content/fillInttra', package: pkg, scope: 'container', containerIndex: 0 })),
      );
    }
    return;
  }

  buttons.append(el('span', { className: 'where', text: 'Open an ACE or INTTRA screen in this tab.' }));
}

function layout(): HTMLElement {
  const header = el('header', { className: 'app-header' }, [
    el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'Q' }),
      el('span', { className: 'brand-name', text: 'Quickfill' }),
    ]),
  ]);

  const clearButton = el('button', { className: 'button button-small', text: 'Clear' });
  clearButton.addEventListener('click', () => {
    box.value = '';
    say('');
    void readBox();
  });

  const section = el('section', { className: 'panel-section' }, [
    box,
    readAs,
    whereLine,
    buttons,
    result,
    el('div', { className: 'button-row' }, [clearButton]),
    el('p', {
      className: 'where',
      text: 'Quickfill types values into the screen you are looking at. It never saves, submits or certifies, and it checks nothing: read the form before you submit.',
    }),
  ]);

  const root = el('div');
  appendAll(root, header, section);
  return root;
}

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  root.append(layout());

  box.addEventListener('input', () => {
    // Re-read on a pause rather than on every keystroke: extraction is cheap,
    // but re-running it 40 times while an email pastes character by character
    // is pointless work.
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void readBox(), 150);
  });

  const saved = await toBackground({ type: 'store/get' });
  if (saved.ok && saved.type === 'store/data' && saved.payload) {
    stored = saved.payload;
    box.value = saved.payload.text;
    readAs.textContent = `Read as: ${saved.payload.summary}`;
    renderLines();
  }

  const found = await toContent({ type: 'content/where' });
  place = found.ok && found.type === 'content/where' ? found.payload : { portal: 'none', label: CONTENT_NOT_READY, hasLines: false, isGrid: false };
  renderButtons();
}

let debounce = 0;

void boot();
