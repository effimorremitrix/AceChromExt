/**
 * The whole interface: a toggle, a box, a few buttons, two lines of text.
 *
 * There is no panel, no side panel, no options page, no tab strip and no
 * settings screen. The ACE Helper's panel has eight tabs because it answers
 * "where did this value come from?"; Quickfill answers "is it in the field?",
 * and the operator answers that by looking at the form.
 *
 * It is a SIDE PANEL, the same surface the other two helpers open, and that is
 * the third answer this file has given to one complaint.
 *
 * Chrome destroys an action popup the moment it loses focus, so the popup this
 * used to be closed on the first click into the grid being filled and the
 * operator went back to the toolbar for each container. The first fix was a
 * "Pop out" button that reopened this page as a floating window. The second,
 * on 2026-09-22, was to stop pretending Quickfill wanted a different surface
 * from the other two: one box needs no docked strip, but the operator does not
 * care which helper they opened, and three helpers behaving three ways is one
 * thing more to remember than a forwarder in a hurry has room for.
 *
 * So the window went with the popup, and with it went `?window=1`, the
 * detached flag, and the question of which window holds the portal. A side
 * panel is docked inside the browser window whose page it is filling, so the
 * ordinary active-tab query is right again.
 *
 * What stays from the window is the part that was never cosmetic: a surface
 * that stays open has to keep LOOKING (`watchBrowser`, below).
 *
 * Built with createElement and textContent only, so nothing pasted can ever be
 * interpreted as markup.
 */

import { appendAll, buildStamp, clear, el } from '../../../src/ui/dom.js';
import { watchBrowser } from '../../../src/ui/liveTab.js';
import { isFailure, parsePaste } from '../paste.js';
import type {
  FillCount,
  FillMode,
  QuickfillBackgroundRequest,
  QuickfillBackgroundResponse,
  QuickfillContentRequest,
  QuickfillContentResponse,
  StoredPaste,
  Where,
} from '../core/messages.js';
import { CONTENT_NOT_READY, NOT_A_PORTAL_TAB } from '../core/messages.js';
// The paste block, built here when the tab cannot be asked for its column
// order. This is not a second write path - `gridPasteBlock` writes nothing,
// it returns the text to put on the clipboard - and it is the same function
// the content script calls, so the two cannot drift.
import { gridPasteBlock } from '../../../inttra-extension/src/content/gridWriter.js';
import type { FilingPackage } from '../../../shared/src/filingPackage.js';

/** Whether the tab can be talked to at all, which is a different question from what is on it. */
type Reach = 'ok' | 'notRunning' | 'offPortal';

let stored: StoredPaste | null = null;
let mode: FillMode = 'auto';
let reach: Reach = 'ok';
let place: Where = { portal: 'none', label: 'Looking...', hasLines: false, canFillForm: false, hasGrid: false, gridWritable: false };

const box = el('textarea', {
  className: 'paste-box',
  attrs: { placeholder: 'Paste the carrier email, a filing-package.json, or spreadsheet rows.', spellcheck: 'false' },
});
const readAs = el('p', { className: 'read-as' });
const whereLine = el('p', { className: 'where' });
const result = el('p', { className: 'result' });
const buttons = el('div', { className: 'button-row button-row-actions' });
const modeRow = el('div', { className: 'mode-row', attrs: { role: 'group', 'aria-label': 'Which portal to fill' } });
const lineSelect = el('select', { className: 'select' });

/**
 * The toggle.
 *
 * Auto is the default and is what the popup did before this existed. The two
 * pins are here because the operator knows which portal they are on and the
 * detector has been wrong about it on the live INTTRA portal - a run that read
 * "INTTRA screen not identified" and blocked Fill on the page being filled.
 * A pin changes which buttons are offered, never what a write is allowed to
 * do: every fill still goes through the same detector-resolved selectors, and
 * an ambiguous match is still refused.
 */
const MODES: Array<{ id: FillMode; label: string; title: string }> = [
  { id: 'auto', label: 'Auto', title: 'The page decides: an AESDirect step fills ACE, an INTTRA screen fills INTTRA.' },
  { id: 'ace', label: 'ACE', title: 'Fill ACE. The four AESDirect steps only; this pin does not make another page fillable.' },
  {
    id: 'inttra',
    label: 'INTTRA',
    title: 'Fill INTTRA. A screen the helper cannot identify is filled as Create Shipping Instruction, and the result line says so.',
  },
];

async function toBackground(message: QuickfillBackgroundRequest): Promise<QuickfillBackgroundResponse> {
  return (await chrome.runtime.sendMessage(message)) as QuickfillBackgroundResponse;
}

async function ask(tabId: number, message: QuickfillContentRequest): Promise<QuickfillContentResponse | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as QuickfillContentResponse;
  } catch {
    // No frame answered: either the script is not in this tab at all, or every
    // frame's listener closed its port without a reply. Null, not an error,
    // because the caller has one more thing to try.
    return null;
  }
}

/**
 * Start the content script in a tab that has none.
 *
 * Chrome injects a content script when a page LOADS. An operator who rebuilds
 * the helper and presses Reload on chrome://extensions has every open portal
 * tab silently orphaned: the manifest still matches them, and not one of them
 * is running the script. On 2026-09-21 that emptied the popup in front of a
 * live Copy Container Details grid with seven containers in the box.
 *
 * So the panel starts it. The only thing it ever injects is this extension's
 * own bundled file, into the five hosts the manifest already asks for - never
 * a function, never a string, never the page's own world. Chrome refuses the
 * call on any other host, which is the check doing its job rather than a case
 * to handle.
 */
async function startInTab(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['quickfillContent.js'] });
    return true;
  } catch {
    return false;
  }
}

/** Re-render when the tab's reachability changes, because it decides which buttons are honest. */
function setReach(next: Reach): void {
  if (reach === next) return;
  reach = next;
  renderButtons();
}

async function toContent(message: QuickfillContentRequest): Promise<QuickfillContentResponse> {
  // The side panel is docked in the browser window whose page it fills, so the
  // active tab of this window is the tab the operator is looking at.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab.' };

  const answer = await ask(tab.id, message);
  if (answer) {
    setReach('ok');
    return answer;
  }

  // `tab.url` is populated only for a tab this extension has host permission
  // for, so its absence says the tab is not a portal at all - no reload would
  // help, and nothing is injected into it.
  const onAPortal = typeof tab.url === 'string' && tab.url !== '';
  if (!onAPortal || !(await startInTab(tab.id))) {
    setReach(onAPortal ? 'notRunning' : 'offPortal');
    return { ok: false, error: onAPortal ? CONTENT_NOT_READY : NOT_A_PORTAL_TAB };
  }

  const second = await ask(tab.id, message);
  if (second) {
    setReach('ok');
    return second;
  }
  setReach('notRunning');
  return { ok: false, error: CONTENT_NOT_READY };
}

function say(text: string, tone: 'plain' | 'error' = 'plain'): void {
  result.textContent = text;
  result.className = tone === 'error' ? 'result read-as-error' : 'result';
}

/** The one line of feedback a fill produces. */
function report(count: FillCount): void {
  // The screen was never identified and the pin made the fill happen anyway,
  // so the line says which screen's fields were tried before it says how many
  // took. An operator reading "Filled 3 of 7" is owed the assumption behind it.
  const assumed = count.assumedScreen ? `The screen was not identified, so the ${count.assumedScreen} fields were tried. ` : '';
  if (count.total === 0) {
    say(`${assumed}Nothing on this screen is mapped to a value in the paste.`);
    return;
  }
  const head = `${assumed}Filled ${count.filled} of ${count.total}.`;
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
async function copyRows(pkg: FilingPackage): Promise<void> {
  const response = await toContent({ type: 'content/gridRows', package: pkg });
  // The tab is asked because only it can see the grid's own column order. When
  // it cannot be reached the block is built here instead, in GRID_COLUMNS
  // order - which is the order the live grid was read in on 2026-09-20
  // (Container Number, Carrier Seal #, Shipper Seal #, Cargo Description,
  // Marks & Numbers, HS Code). This is the one route that needs nothing from
  // the page, and withdrawing it because the page could not be asked was the
  // whole cost of the 2026-09-21 run: the grid was on the screen, the seven
  // containers were in the box, and the popup offered no way to move them.
  if (response.ok && response.type !== 'content/rows') return;
  const fromTab = response.ok;
  const block = response.ok ? response.payload : gridPasteBlock(pkg, null);
  try {
    await navigator.clipboard.writeText(block.tsv);
    // One line, but it names the columns: the operator can see whether the
    // seal is in it before pasting, which is the whole check Quickfill keeps.
    const headings = block.columns.map((column) => column.heading).join(', ');
    const blank = block.blank.length ? ` Blank: ${block.blank.join(', ')}.` : '';
    const order = block.fromGrid
      ? ''
      : fromTab
        ? ' No grid was found, so this is the default order.'
        : ' Quickfill is not running in this tab, so the grid could not be read and this is the default order.';
    say(`${block.rows} row(s) copied as ${headings}.${blank}${order} Click the first Container Number cell of the first empty row in INTTRA and paste.`);
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

function fillButton(label: string, run: () => Promise<void>, rank: 'primary' | 'secondary' = 'primary', title?: string): HTMLButtonElement {
  const button = el('button', { className: rank === 'primary' ? 'button button-primary' : 'button', text: label, ...(title ? { title } : {}) });
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

/** Ask the tab again. The answer depends on the toggle, so this runs whenever it moves. */
async function locate(): Promise<void> {
  const found = await toContent({ type: 'content/where', mode });
  place =
    found.ok && found.type === 'content/where'
      ? found.payload
      : { portal: 'none', label: found.ok ? CONTENT_NOT_READY : found.error, hasLines: false, canFillForm: false, hasGrid: false, gridWritable: false };
  renderButtons();
}

function renderModes(): void {
  clear(modeRow);
  for (const option of MODES) {
    const active = option.id === mode;
    const button = el('button', {
      className: `mode-button${active ? ' mode-button-active' : ''}`,
      text: option.label,
      title: option.title,
      attrs: { type: 'button', 'aria-pressed': String(active) },
    });
    button.addEventListener('click', () => {
      if (mode === option.id) return;
      mode = option.id;
      renderModes();
      say('');
      void toBackground({ type: 'store/mode', mode });
      void locate();
    });
    modeRow.append(button);
  }
}

/**
 * The ACE buttons: the step, and a line on the Commodities step.
 */
function aceButtons(): void {
  if (!stored) return;
  const shipment = stored.shipment;
  buttons.append(fillButton('Fill this page', () => run({ type: 'content/fillAce', shipment, scope: 'shipment' })));
  if (place.hasLines && shipment.commodities.length) {
    buttons.append(
      fillButton('Fill line', () => run({ type: 'content/fillAce', shipment, scope: 'commodityLine', line: Number(lineSelect.value) || 1 }), 'secondary'),
      lineSelect,
    );
  }
}

/**
 * The INTTRA buttons: both routes, whenever both exist.
 *
 * The INTTRA Helper reaches the form and the grid from two tabs that are
 * always there. This is the same reach in one row: the form pair is offered
 * whenever the named screen has fields, the grid button whenever a grid is on
 * the page, and Copy rows whenever the paste has containers - it needs no
 * screen at all, which is why it survived the fifth live run when nothing else
 * did.
 *
 * Which one leads is the one thing the page decides. A grid that cannot be
 * typed into puts Copy rows first and says why BEFORE the click, because on
 * the live portal two equal blue buttons read as two equal routes and Fill was
 * pressed first, wrote nothing, and only then explained itself.
 */
function inttraButtons(pkg: FilingPackage): void {
  // A grid on the page is what the operator is looking at, so the grid pair
  // leads; a grid that cannot be typed into puts Copy rows at the head of it.
  const gridLeads = place.hasGrid;
  const copyLeads = place.hasGrid && !place.gridWritable;
  const assumed = place.assumingCreatePage
    ? 'The screen was not identified. The toggle is set to INTTRA, so this writes the Create Shipping Instruction fields.'
    : undefined;

  const form: HTMLElement[] = [];
  if (place.canFillForm) {
    form.push(
      fillButton('Fill this screen', () => run({ type: 'content/fillInttra', package: pkg, scope: 'shipment', mode }), gridLeads ? 'secondary' : 'primary', assumed),
    );
    if (pkg.containers.length) {
      // One press per screen, not per container: the live page repeats the
      // Particulars block per container and numbers the rows from 1 upward, so
      // the helper walks them. No index means every container.
      form.push(
        fillButton(
          pkg.containers.length === 1 ? 'Fill container 1' : `Fill all ${pkg.containers.length} containers`,
          () => run({ type: 'content/fillInttra', package: pkg, scope: 'container', mode }),
          'secondary',
          assumed,
        ),
      );
    }
  }

  const grid: HTMLElement[] = [];
  if (pkg.containers.length) {
    // Copy rows needs no screen at all - the block is the package's containers
    // in the grid's order, or the default one - which is why it is the button
    // that survived the run where nothing was identified.
    // Exactly one button in the row is blue, and it is the one that works: a
    // grid that cannot be typed into makes it Copy rows, and so does a screen
    // that offers nothing else at all.
    const copyIsTheRoute = copyLeads || (!place.hasGrid && !place.canFillForm);
    const copy = fillButton('Copy rows', () => copyRows(pkg), copyIsTheRoute ? 'primary' : 'secondary');
    if (place.hasGrid) {
      const fill = fillButton('Fill container grid', () => run({ type: 'content/fillGrid', package: pkg }), place.gridWritable ? 'primary' : 'secondary');
      grid.push(...(copyLeads ? [copy, fill] : [fill, copy]));
    } else {
      grid.push(copy);
    }
  }

  if (!form.length && !grid.length) {
    buttons.append(el('span', { className: 'where', text: 'The paste has no containers, so there is nothing to copy for the grid.' }));
    return;
  }

  for (const button of gridLeads ? [...grid, ...form] : [...form, ...grid]) buttons.append(button);

  // Only with the pair it is about: a paste with no containers has no Copy
  // rows button for the note to explain.
  if (copyLeads && grid.length) {
    buttons.append(
      el('span', {
        className: 'where grid-note',
        text: 'This grid opens an editor when a cell is clicked, so Fill container grid has nothing to type into and will write 0 cells. Copy rows, click the first Container Number cell of the first empty row, and paste.',
      }),
    );
  }
}

/**
 * The tab could not be reached, and one route survives that.
 *
 * Copy rows needs nothing from the page: the block is the package's own
 * containers in the grid's default column order. On 2026-09-21 it was
 * withdrawn along with everything else because ONE message failed, and the
 * operator was left in front of the grid they were trying to fill with no way
 * in. It is offered here, and the line says plainly what does not work and
 * what fixes it - never "open an ACE or INTTRA screen", which on that run was
 * advice to do what the operator had already done.
 */
function unreachableButtons(pkg: FilingPackage): void {
  // The line above already says what happened, so this one says only what it
  // costs. Two sentences saying the same thing is the wart being fixed.
  if (reach === 'offPortal' || !pkg.containers.length) {
    buttons.append(
      el('span', {
        className: 'where',
        text: reach === 'offPortal' ? 'Open an ACE or INTTRA screen in this tab.' : 'The paste has no containers, so there is nothing to copy either.',
      }),
    );
    return;
  }
  buttons.append(fillButton('Copy rows', () => copyRows(pkg), 'primary'));
  buttons.append(
    el('span', {
      className: 'where grid-note',
      text: 'Quickfill could not start in this tab, so nothing on the page can be read or filled. Copy rows still copies the container block, in the default column order, for Copy Container Details. Reload the page to fill fields.',
    }),
  );
}

function renderButtons(): void {
  clear(buttons);
  whereLine.textContent = place.label;

  if (!stored) {
    buttons.append(el('span', { className: 'where', text: 'Paste something above to fill.' }));
    return;
  }

  if (reach !== 'ok') {
    unreachableButtons(stored.package);
    return;
  }

  if (place.portal === 'ace') {
    if (!place.canFillForm) {
      buttons.append(el('span', { className: 'where', text: 'Open one of the four AESDirect filing steps in this tab.' }));
      return;
    }
    aceButtons();
    return;
  }

  if (place.portal === 'inttra') {
    inttraButtons(stored.package);
    return;
  }

  buttons.append(el('span', { className: 'where', text: 'Open an ACE or INTTRA screen in this tab.' }));
}

function layout(): HTMLElement {
  const stamp = buildStamp();
  const header = el('header', { className: 'app-header' }, [
    el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'Q' }),
      el('span', { className: 'brand-name', text: 'Quickfill' }),
      stamp ? el('span', { className: 'build-stamp', text: stamp, title: 'The build this helper is running: version, git commit, build time (UTC)' }) : null,
    ]),
  ]);

  const clearButton = el('button', { className: 'button button-small', text: 'Clear' });
  clearButton.addEventListener('click', () => {
    box.value = '';
    say('');
    void readBox();
  });

  const footer = el('div', { className: 'button-row' }, [clearButton]);

  const section = el('section', { className: 'panel-section' }, [
    modeRow,
    box,
    readAs,
    whereLine,
    buttons,
    result,
    footer,
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
  if (saved.ok && saved.type === 'store/data') {
    mode = saved.payload.mode;
    if (saved.payload.paste) {
      stored = saved.payload.paste;
      box.value = saved.payload.paste.text;
      readAs.textContent = `Read as: ${saved.payload.paste.summary}`;
      renderLines();
    }
  }
  renderModes();
  await locate();

  // A popup was destroyed before any of this could change. A side panel is
  // not: the operator switches to the ACE tab, opens a second draft, reloads
  // the portal, and the panel is still on the screen saying what WAS there.
  // Re-ask. `locate` repaints the button row only, never the paste box, so
  // this cannot take the caret out from under someone mid-paste.
  watchBrowser(() => locate());
}

let debounce = 0;

void boot();
