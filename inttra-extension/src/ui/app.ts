/**
 * INTTRA Helper UI, rendered in the popup and the panel.
 *
 *   Import      a filing-package.json (from the ACE Helper, or ace-export package)
 *   Deckhand    paste the carrier's email; extract, review, approve
 *   Package     the merged shipment with every value's provenance
 *   Fill        Fill Current Page on the INTTRA screen that is open
 *   Containers  Fill the Copy Container Details grid, or copy its rows
 *   Diagnostics page detection, field detection, grid detection, the
 *               DevTools capture list, and the selector override editor
 *
 * Safety invariants: nothing is written to INTTRA without a button click,
 * nothing here saves, continues, submits or logs in, and nothing leaves the
 * machine - copy writes the clipboard and save writes a file the operator
 * chose to download.
 */

import { el, byId, buildStamp, clear, show } from '../../../src/ui/dom.js';
import { renderDeckhandTab } from '../../../src/ui/deckhandTab.js';
import { renderPackageTab } from '../../../src/ui/packageTab.js';
import { formatLog, type SessionLogEntry, type SessionLogKind } from '../../../src/core/sessionLog.js';
import { emptyOverrides, serializeOverrides, starterOverrides, type SelectorOverrides } from '../../../src/ace/selectors/overrides.js';
import { buildFilingPackage, fillGate, filingPackageFileName, parseFilingPackageJson, serializeFilingPackage, type FilingPackage } from '../../../shared/src/index.js';
import { DEFAULT_INTTRA_SETTINGS, loadInttraSettings, saveInttraSettings, type InttraHelperSettings } from '../core/settings.js';
import type { InttraDiagnosticsSnapshot, InttraGridStatus } from '../core/messages.js';
import { emptyStoredPackage, type StoredPackage } from '../core/store.js';
import { clearInttraOverrides, loadInttraOverrides, saveInttraOverrides } from '../core/overridesStore.js';
import type { InttraPageDetection } from '../content/pageDetector.js';
import type { GridFillReport } from '../content/gridWriter.js';
import type { InttraFillReport } from '../models/InttraField.js';
import { ALL_INTTRA_MAPPINGS, GRID_COLUMNS, GRID_DEVTOOLS_CHECKLIST, NOTIFICATION_EMAILS_NOTE, unverifiedInttraFieldKeys } from '../mappings/index.js';
import { INTTRA_PAGE_SIGNATURES } from '../pages.js';
import { gridPasteBlock, type GridPasteBlock } from '../content/gridWriter.js';
import { resolveInttraTab, sendToBackground, sendToTab, type InttraTab } from './tabs.js';

export type Surface = 'popup' | 'panel';
type StatusTone = 'info' | 'ok' | 'warn' | 'error';

interface AppState {
  surface: Surface;
  settings: InttraHelperSettings;
  stored: StoredPackage;
  tab: InttraTab | null;
  page: InttraPageDetection | null;
  /** What the tab said about its container grid the last time it was asked; null until then. */
  grid: InttraGridStatus | null;
  report: InttraFillReport | null;
  /** One report per container, from "Fill all containers". */
  reports: InttraFillReport[] | null;
  gridReport: GridFillReport | null;
  diagnostics: InttraDiagnosticsSnapshot | null;
  status: { text: string; tone: StatusTone } | null;
  activeTab: string;
  log: SessionLogEntry[];
  overrides: SelectorOverrides;
  overridesDraft: string | null;
  deckhandDraft: string;
}

const state: AppState = {
  surface: 'popup',
  settings: { ...DEFAULT_INTTRA_SETTINGS },
  stored: emptyStoredPackage(),
  tab: null,
  page: null,
  grid: null,
  report: null,
  reports: null,
  gridReport: null,
  diagnostics: null,
  status: null,
  activeTab: 'overview',
  log: [],
  overrides: emptyOverrides(),
  overridesDraft: null,
  deckhandDraft: '',
};

// ---------------------------------------------------------------- utilities

function setStatus(text: string, tone: StatusTone): void {
  state.status = { text, tone };
  renderStatus();
}

function renderStatus(): void {
  const bar = document.getElementById('status');
  if (!bar) return;
  clear(bar);
  if (!state.status) {
    show(bar, false);
    return;
  }
  show(bar, true);
  bar.className = `status status-${state.status.tone}`;
  bar.append(el('span', { text: state.status.text }));
}

async function appendLog(kind: SessionLogKind, message: string, detail?: string): Promise<void> {
  await sendToBackground({ type: 'log/append', kind, message, ...(detail ? { detail } : {}) });
}

async function refreshLog(): Promise<void> {
  const response = await sendToBackground({ type: 'log/get' });
  state.log = response.ok && response.type === 'log/data' ? response.payload : [];
}

function copyToClipboard(text: string, what: string): void {
  void navigator.clipboard
    .writeText(text)
    .then(() => setStatus(`${what} copied to the clipboard.`, 'ok'))
    .catch(() => setStatus('Could not copy to the clipboard.', 'error'));
}

function downloadText(text: string, fileName: string): void {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { attrs: { href: url, download: fileName } });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Saved ${fileName}. It was written to this machine only.`, 'ok');
  } catch (error) {
    setStatus(`Could not save the file: ${(error as Error).message}`, 'error');
  }
}

async function refreshStored(): Promise<void> {
  const response = await sendToBackground({ type: 'store/get' });
  state.stored = response.ok && response.type === 'store/data' ? response.payload : emptyStoredPackage();
}

async function store(next: StoredPackage): Promise<void> {
  const response = await sendToBackground({ type: 'store/set', payload: next });
  state.stored = response.ok && response.type === 'store/data' ? response.payload : next;
}

async function refreshTab(): Promise<void> {
  state.tab = await resolveInttraTab();
  state.page = null;
  state.grid = null;
  if (!state.tab) return;
  const response = await sendToTab(state.tab.id, { type: 'content/detectPage' });
  if (response.ok && response.type === 'content/page') {
    state.page = response.payload;
    // A content script from before the grid status was added answers without
    // it; null then reads as "cannot type", and Copy rows leads.
    state.grid = response.grid ?? null;
  }
}

/** The first N characters, with a mark when there were more. */
function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

function pkg(): FilingPackage | null {
  return state.stored.package;
}

// -------------------------------------------------------------------- import

async function onFileChosen(file: File): Promise<void> {
  setStatus(`Reading ${file.name}...`, 'info');
  try {
    const text = await file.text();
    const loaded = parseFilingPackageJson(text);
    await store({
      package: loaded,
      deckhand: loaded.shipment ? { shipment: loaded.shipment, approvedAt: loaded.review.approvedAt } : state.stored.deckhand,
      selectedContainer: 0,
      sourceName: file.name,
    });
    state.report = null;
    state.reports = null;
    state.gridReport = null;
    await appendLog('import', `Loaded ${file.name}: package ${loaded.packageId}, ${loaded.containers.length} container(s), Deckhand ${loaded.review.deckhand}.`);
    await refreshLog();
    state.activeTab = 'package';
    const gate = fillGate(loaded);
    setStatus(gate.ok ? `Package ${loaded.packageId} loaded and ready to fill.` : `Package ${loaded.packageId} loaded. Before filling: ${gate.reasons.join(' ')}`, gate.ok ? 'ok' : 'warn');
  } catch (error) {
    setStatus(`Could not load ${file.name}: ${(error as Error).message}`, 'error');
  }
  render();
}

async function clearAll(): Promise<void> {
  await sendToBackground({ type: 'store/clear' });
  state.stored = emptyStoredPackage();
  state.report = null;
  state.gridReport = null;
  if (state.tab) await sendToTab(state.tab.id, { type: 'content/clearHighlights' });
  await refreshLog();
  setStatus('Package, extraction and session log cleared from memory.', 'ok');
  render();
}

// ---------------------------------------------------------------------- fill

function readyToFill(): { ok: boolean; reason: string } {
  const current = pkg();
  if (!current) return { ok: false, reason: 'Load a filing package first (Import), or build one from a Deckhand extraction (Package).' };
  const gate = fillGate(current);
  if (!gate.ok) return { ok: false, reason: gate.reasons.join(' ') };
  return { ok: true, reason: '' };
}

async function fill(scope: 'shipment' | 'container', dryRun: boolean): Promise<void> {
  const current = pkg();
  const ready = readyToFill();
  if (!current || !ready.ok) {
    setStatus(ready.reason, 'warn');
    return;
  }
  await refreshTab();
  if (!state.tab) {
    setStatus('No INTTRA tab is open. Open your Shipping Instruction in INTTRA, then try again.', 'error');
    render();
    return;
  }
  if (!state.page || state.page.page === 'unknown') {
    setStatus('The INTTRA screen could not be identified, so nothing was filled. Open a Shipping Instructions screen and press refresh in the header.', 'error');
    render();
    return;
  }
  const overwrite = (document.getElementById('overwrite') as HTMLInputElement | null)?.checked ?? false;
  const response = await sendToTab(state.tab.id, {
    type: 'content/fill',
    scope,
    ...(scope === 'container' ? { containerIndex: state.stored.selectedContainer } : {}),
    package: current,
    ...(dryRun ? { dryRun: true } : {}),
    ...(overwrite ? { overwrite: true } : {}),
  });
  if (!response.ok) {
    setStatus(response.error, 'error');
    render();
    return;
  }
  if (response.type !== 'content/fillReport') return;
  state.report = response.payload;
  state.reports = null;
  await refreshLog();
  const { filled, skipped, warnings, errors } = response.payload;
  setStatus(`${dryRun ? 'Dry run (nothing written)' : 'Done'}: filled ${filled}, skipped ${skipped}, warnings ${warnings}${errors ? `, errors ${errors}` : ''}. Review every field in INTTRA before you save or submit.`, errors ? 'error' : warnings ? 'warn' : 'ok');
  render();
}

/**
 * Fill every container block on the screen, one row each.
 *
 * The live portal repeats the Particulars block per container and numbers its
 * controls from 1 upward, so container k in the package is written into row
 * k+1 and each row's number and seals travel together. One pass per row, each
 * reported on its own: a row INTTRA does not have yet is reported as not
 * found, never written somewhere else.
 */
async function fillAllContainers(dryRun: boolean): Promise<void> {
  const current = pkg();
  const ready = readyToFill();
  if (!current || !ready.ok) {
    setStatus(ready.reason, 'warn');
    return;
  }
  if (!current.containers.length) {
    setStatus('This package has no containers.', 'warn');
    return;
  }
  await refreshTab();
  if (!state.tab) {
    setStatus('No INTTRA tab is open. Open your Shipping Instruction in INTTRA, then try again.', 'error');
    render();
    return;
  }
  if (!state.page || state.page.page === 'unknown') {
    setStatus('The INTTRA screen could not be identified, so nothing was filled. Open a Shipping Instructions screen and press refresh in the header.', 'error');
    render();
    return;
  }
  const overwrite = (document.getElementById('overwrite') as HTMLInputElement | null)?.checked ?? false;
  const reports: InttraFillReport[] = [];
  for (let index = 0; index < current.containers.length; index += 1) {
    const response = await sendToTab(state.tab.id, {
      type: 'content/fill',
      scope: 'container',
      containerIndex: index,
      package: current,
      ...(dryRun ? { dryRun: true } : {}),
      ...(overwrite ? { overwrite: true } : {}),
    });
    if (!response.ok) {
      setStatus(`${response.error} Stopped after ${reports.length} container(s).`, 'error');
      break;
    }
    if (response.type === 'content/fillReport') reports.push(response.payload);
  }
  state.reports = reports;
  state.report = null;
  await refreshLog();
  if (reports.length) {
    const filled = reports.reduce((sum, report) => sum + report.filled, 0);
    const warnings = reports.reduce((sum, report) => sum + report.warnings, 0);
    const errors = reports.reduce((sum, report) => sum + report.errors, 0);
    setStatus(
      `${dryRun ? 'Dry run (nothing written)' : 'Done'}: ${reports.length} container(s), filled ${filled}, warnings ${warnings}${errors ? `, errors ${errors}` : ''}. Read every row in INTTRA before you save or submit.`,
      errors ? 'error' : warnings ? 'warn' : 'ok',
    );
  }
  render();
}

async function fillGrid(dryRun: boolean): Promise<void> {
  const current = pkg();
  const ready = readyToFill();
  if (!current || !ready.ok) {
    setStatus(ready.reason, 'warn');
    return;
  }
  await refreshTab();
  if (!state.tab) {
    setStatus('No INTTRA tab is open.', 'error');
    render();
    return;
  }
  const overwrite = (document.getElementById('overwrite-grid') as HTMLInputElement | null)?.checked ?? false;
  const anyPage = (document.getElementById('grid-any-page') as HTMLInputElement | null)?.checked ?? false;
  const response = await sendToTab(state.tab.id, { type: 'content/fillGrid', package: current, ...(dryRun ? { dryRun: true } : {}), ...(overwrite ? { overwrite: true } : {}), ...(anyPage ? { anyPage: true } : {}) });
  if (!response.ok) {
    setStatus(response.error, 'error');
    render();
    return;
  }
  if (response.type !== 'content/gridReport') return;
  state.gridReport = response.payload;
  await refreshLog();
  const report = response.payload;
  setStatus(
    `${dryRun ? 'Dry run (nothing written)' : 'Grid filled'}: containers filled ${report.containersFilled} of ${report.rowsNeeded}, verified cells ${report.verifiedCells}, warnings ${report.warnings}, failed ${report.failed}, unresolved ${report.unresolved}.`,
    report.failed ? 'error' : report.warnings || report.unresolved || report.rowsAvailable < report.rowsNeeded ? 'warn' : 'ok',
  );
  render();
}

/**
 * Put the containers on the clipboard as the grid's own columns.
 *
 * The INTTRA tab produces the block, because only it can see the grid and
 * therefore its column order; the panel only copies. Copy Container Details is
 * the screen INTTRA built for pasting a block of rows into, and on the live
 * portal, whose cells open an editor on click, it is the only way in. Nothing
 * is pressed on the operator's behalf: the paste is theirs.
 */
async function copyRows(): Promise<void> {
  const current = pkg();
  if (!current) {
    setStatus('Load or build a filing package first.', 'warn');
    return;
  }
  await refreshTab();
  let block: GridPasteBlock | null = null;
  let problem = '';
  if (!state.tab) {
    problem = 'No INTTRA tab is open, so this is the default column order.';
  } else {
    const response = await sendToTab(state.tab.id, { type: 'content/gridRows', package: current });
    if (response.ok && response.type === 'content/rows') block = response.payload;
    else problem = `${response.ok ? 'The INTTRA tab returned no rows.' : response.error} This is the default column order.`;
  }
  if (!block) block = gridPasteBlock(current, null);
  else if (!block.fromGrid) problem = 'No container grid was found on the INTTRA tab, so this is the default column order; open Copy Container Details there and copy again.';
  try {
    await navigator.clipboard.writeText(block.tsv);
  } catch {
    setStatus('Could not copy to the clipboard.', 'error');
    render();
    return;
  }
  const headings = block.columns.map((column) => column.heading).join(', ');
  const blank = block.blank.length ? ` Left blank, because no package column matches the heading: ${block.blank.join(', ')}.` : '';
  const said = `${block.rows} row(s) copied, ${block.width} column(s)${block.fromGrid ? " in the grid's own order" : ''}: ${headings}.${blank}${problem ? ` ${problem}` : ''}`;
  setStatus(`${said} In INTTRA, click the first Container Number cell of the first empty row and press Ctrl+V.`, problem || block.blank.length ? 'warn' : 'ok');
  await appendLog('note', said);
  await refreshLog();
  render();
}

async function runDiagnostics(): Promise<void> {
  await refreshTab();
  if (!state.tab) {
    setStatus('No INTTRA tab is open.', 'error');
    render();
    return;
  }
  const response = await sendToTab(state.tab.id, { type: 'content/diagnostics' });
  if (!response.ok) setStatus(response.error, 'error');
  else if (response.type === 'content/diagnostics') {
    state.diagnostics = response.payload;
    setStatus('Diagnostics refreshed.', 'ok');
  }
  await refreshLog();
  render();
}

async function revealField(key: string): Promise<void> {
  if (!state.tab) return;
  const response = await sendToTab(state.tab.id, { type: 'content/revealField', key });
  if (response.ok && response.type === 'content/revealed' && !response.found) {
    setStatus(`Field "${key}" is not highlighted on the INTTRA page (it may not have been written).`, 'warn');
  }
}

// ------------------------------------------------------------------ sections

function renderHeader(): HTMLElement {
  const page = state.page;
  const tone = !state.tab ? 'grey' : page && page.page !== 'unknown' ? (page.confidence === 'high' ? 'green' : 'yellow') : 'red';
  const text = !state.tab ? 'No INTTRA tab detected' : page && page.page !== 'unknown' ? `${page.label} (${page.confidence} confidence)` : 'INTTRA screen not identified';
  const refresh = el('button', { className: 'link-button', text: 'refresh', attrs: { type: 'button' } });
  refresh.addEventListener('click', () => void refreshTab().then(render));
  const stamp = buildStamp();
  // Which tab answered. The panel is a tab of its own, so the INTTRA tab it
  // addresses is a choice (tabs.ts), and a wrong choice must be visible.
  const tabTitle = state.tab ? state.tab.title || state.tab.url : '';
  return el('header', { className: 'app-header' }, [
    el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'INTTRA' }),
      el('span', { className: 'brand-name', text: 'Helper' }),
      stamp ? el('span', { className: 'build-stamp', text: stamp, title: 'The build this helper is running: version, git commit, build time (UTC)' }) : null,
    ]),
    el('div', { className: 'page-chip' }, [
      el('span', { className: `pill pill-${tone}`, text, ...(tabTitle ? { title: `On the tab: ${tabTitle}` } : {}) }),
      tabTitle ? el('span', { className: 'tab-title', text: shorten(tabTitle, 36), title: state.tab?.url ?? '' }) : null,
      refresh,
    ]),
  ]);
}

function renderTabs(): HTMLElement {
  const tabs: Array<{ id: string; label: string }> =
    state.surface === 'panel'
      ? [
          { id: 'overview', label: 'Overview' },
          { id: 'import', label: 'Import' },
          { id: 'deckhand', label: 'Deckhand' },
          { id: 'package', label: 'Package' },
          { id: 'fill', label: 'Fill INTTRA' },
          { id: 'containers', label: 'Containers' },
          { id: 'settings', label: 'Settings' },
          { id: 'diagnostics', label: 'Diagnostics' },
        ]
      : [
          { id: 'overview', label: 'Overview' },
          { id: 'fill', label: 'Fill INTTRA' },
          { id: 'containers', label: 'Containers' },
        ];
  if (!tabs.some((tab) => tab.id === state.activeTab)) state.activeTab = tabs[0]?.id ?? 'overview';
  const nav = el('nav', { className: 'tabs', attrs: { role: 'tablist' } });
  for (const tab of tabs) {
    const button = el('button', { className: `tab${state.activeTab === tab.id ? ' tab-active' : ''}`, text: tab.label, attrs: { type: 'button', role: 'tab', 'aria-selected': String(state.activeTab === tab.id) } });
    button.addEventListener('click', () => {
      state.activeTab = tab.id;
      render();
    });
    nav.append(button);
  }
  return nav;
}

function actionButton(label: string, tab: string, primary = false): HTMLElement {
  const button = el('button', { className: `button${primary ? ' button-primary' : ''}`, text: label, attrs: { type: 'button' } });
  button.addEventListener('click', () => {
    state.activeTab = tab;
    render();
  });
  return button;
}

function openPanelButton(label: string): HTMLElement {
  const button = el('button', { className: 'button', text: label, attrs: { type: 'button' } });
  button.addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') }));
  return button;
}

function tick(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}

function renderOverview(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Shipment' }));
  const current = pkg();
  if (!current) {
    section.append(
      el('p', { className: 'muted', text: 'Nothing loaded. Import a filing-package.json, or paste the carrier email into Deckhand and build a package.' }),
      state.surface === 'panel' ? el('div', { className: 'actions' }, [actionButton('Import a package', 'import', true), actionButton('Deckhand', 'deckhand')]) : openPanelButton('Open the panel to import'),
    );
    return section;
  }
  const gate = fillGate(current);
  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'invoice-number', text: current.packageId }),
      el('div', { text: `Booking ${current.header.bookingReference.value || '(missing)'} - ${current.header.vessel.value || '(no vessel)'}${current.header.voyage.value ? ` / ${current.header.voyage.value}` : ''}` }),
      el('div', { className: 'small muted', text: `${current.containers.length} container(s) - ${state.stored.sourceName || 'built in this panel'}` }),
    ]),
  );
  const lines: Array<{ status: 'pass' | 'warn' | 'fail'; text: string }> = [
    { status: 'pass', text: 'Package loaded' },
    { status: current.review.deckhand === 'pending' ? 'warn' : 'pass', text: current.shipment ? `Deckhand extraction ${current.review.deckhand}` : 'No Deckhand extraction (commercial data only)' },
    ...(current.conflicts.length ? [{ status: (current.conflicts.some((item) => item.resolution === 'unresolved' && item.material) ? 'fail' : 'warn') as 'fail' | 'warn', text: `${current.conflicts.length} conflict(s) between sources` }] : []),
    { status: gate.ok ? 'pass' : 'fail', text: gate.ok ? 'Ready to fill' : 'Not ready to fill' },
    ...(!state.tab ? [{ status: 'warn' as const, text: 'No INTTRA tab open' }] : []),
  ];
  section.append(
    el('h2', { text: 'Status' }),
    el('ul', { className: 'status-list' }, lines.map((line) => el('li', { className: `status-line status-${line.status}` }, [el('span', { className: 'status-mark', text: tick(line.status) }), el('span', { text: line.text })]))),
  );
  const actions = el('div', { className: 'actions actions-grid' }, [
    ...(state.surface === 'panel' ? [actionButton('Package', 'package')] : []),
    actionButton('Fill Current Page', 'fill', true),
    actionButton('Container grid', 'containers'),
  ]);
  const clearButton = el('button', { className: 'button button-danger', text: 'Clear Data', attrs: { type: 'button' } });
  clearButton.addEventListener('click', () => void clearAll());
  actions.append(clearButton);
  section.append(el('h2', { text: 'Actions' }), actions);
  return section;
}

function renderImport(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Import' }),
    el('p', { className: 'small muted', text: 'Load the filing-package.json written by the ACE Helper panel or by "ace-export package". It is read in this browser and uploaded nowhere.' }),
  );
  const fileInput = el('input', { className: 'file-input', attrs: { type: 'file', accept: '.json' } }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void onFileChosen(file);
  });
  section.append(el('label', { className: 'field' }, [el('span', { text: 'Filing package (.json)' }), fileInput]));
  section.append(el('p', { className: 'small muted', text: 'No package yet? Paste the carrier email into the Deckhand tab and build a Deckhand-only package: booking, vessel, ports, containers and seals. The commercial data (cargo, weights, consignee) comes only from a package built beside the invoice.' }));
  if (pkg()) {
    section.append(el('div', { className: 'card small' }, [el('strong', { text: pkg()?.packageId ?? '' }), el('span', { className: 'muted', text: ` - ${state.stored.sourceName || 'built in this panel'}` })]));
  }
  return section;
}

function renderDeckhand(): HTMLElement {
  return renderDeckhandTab({
    current: state.stored.deckhand,
    draft: state.deckhandDraft,
    destination: 'INTTRA',
    onDraftChange: (text) => {
      state.deckhandDraft = text;
    },
    onExtracted: async (shipment) => {
      await store({ ...state.stored, deckhand: { shipment, approvedAt: null } });
      await appendLog('note', `Deckhand extracted ${shipment.containers.length} container(s) from ${shipment.source.name}.`);
      await refreshLog();
      render();
    },
    onApproved: async (approvedAt) => {
      const current = state.stored.deckhand;
      if (!current) return;
      await store({ ...state.stored, deckhand: { shipment: current.shipment, approvedAt } });
      await appendLog('note', 'Deckhand extraction approved.');
      await refreshLog();
      render();
    },
    onCleared: async () => {
      await store({ ...state.stored, deckhand: null });
      render();
    },
    setStatus,
    copyToClipboard,
    downloadText,
  });
}

async function buildPackage(): Promise<void> {
  const deckhand = state.stored.deckhand;
  const existing = pkg();
  if (!deckhand && !existing) return;
  const built = buildFilingPackage({
    invoice: existing?.invoice ?? null,
    commercialSource: existing?.commercialSource ?? null,
    shipment: deckhand?.shipment ?? existing?.shipment ?? null,
    deckhandApproved: !!(deckhand?.approvedAt ?? (existing?.review.deckhand === 'approved')),
    approvedAt: deckhand?.approvedAt ?? existing?.review.approvedAt ?? null,
    decisions: existing?.decisions,
  });
  await store({ ...state.stored, package: built, sourceName: state.stored.sourceName || 'built in this panel' });
  await appendLog('note', `Filing package ${built.packageId} built: ${built.containers.length} container(s), ${built.conflicts.length} conflict(s).`);
  await refreshLog();
  setStatus(`Filing package ${built.packageId} built.`, built.conflicts.length ? 'warn' : 'ok');
  render();
}

function renderPackage(): HTMLElement {
  const current = pkg();
  const deckhand = state.stored.deckhand;
  const buildable = deckhand || current ? { ok: true, reason: '' } : { ok: false, reason: 'Import a filing-package.json, or extract an email in the Deckhand tab first.' };
  return renderPackageTab({
    pkg: current,
    buildable,
    destination: 'INTTRA',
    onBuild: buildPackage,
    onChange: async (next) => {
      const nextDeckhand = next.review.deckhand === 'approved' && deckhand && !deckhand.approvedAt ? { shipment: deckhand.shipment, approvedAt: next.review.approvedAt } : deckhand;
      await store({ ...state.stored, package: next, deckhand: nextDeckhand });
      render();
    },
    onClear: async () => {
      await store({ ...state.stored, package: null });
      setStatus('Filing package discarded. The Deckhand extraction is still here.', 'ok');
      render();
    },
    setStatus,
    copyToClipboard,
    downloadText,
  });
}

function renderReport(report: InttraFillReport): HTMLElement {
  const card = el('div', { className: 'card' }, [
    el('div', { className: 'report-summary' }, [
      el('span', { className: 'pill pill-green', text: `Filled: ${report.filled}` }),
      el('span', { className: 'pill pill-grey', text: `Skipped: ${report.skipped}` }),
      el('span', { className: `pill pill-${report.warnings ? 'yellow' : 'grey'}`, text: `Warnings: ${report.warnings}` }),
      report.errors ? el('span', { className: 'pill pill-red', text: `Errors: ${report.errors}` }) : null,
    ]),
  ]);
  const list = el('ul', { className: 'outcome-list small' });
  for (const outcome of report.outcomes) {
    const tone = outcome.status === 'filled' ? 'green' : outcome.status === 'transformed' ? 'yellow' : outcome.status === 'error' ? 'red' : outcome.status === 'warning' ? 'yellow' : 'grey';
    const item = el('li', { className: `outcome outcome-${tone}` }, [
      el('span', { className: `dot dot-${tone === 'grey' ? 'yellow' : tone}` }),
      el('span', { className: 'outcome-label', text: outcome.label }),
      outcome.written ? el('code', { text: outcome.written }) : null,
      outcome.provenance ? el('span', { className: 'muted', text: ` (${outcome.provenance})` }) : null,
      outcome.message ? el('div', { className: 'outcome-message', text: outcome.message }) : null,
    ]);
    if (outcome.status !== 'skipped') {
      const jump = el('button', { className: 'link-button', text: 'show field', attrs: { type: 'button' } });
      jump.addEventListener('click', () => void revealField(outcome.key));
      item.append(jump);
    }
    list.append(item);
  }
  card.append(list);
  return card;
}

function renderFill(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Fill INTTRA' }),
    el('div', { className: 'notice' }, [
      el('strong', { text: 'You stay in control. ' }),
      el('span', { text: 'INTTRA Helper types values into the screen you have open. It never saves, continues, submits, accepts a declaration, or logs in. Review every field, then continue in INTTRA yourself.' }),
    ]),
  );
  const current = pkg();
  if (!current) {
    section.append(el('p', { className: 'muted', text: 'Load or build a filing package first.' }));
    if (state.surface === 'popup') section.append(openPanelButton('Open the panel'));
    return section;
  }
  const ready = readyToFill();
  if (!ready.ok) section.append(el('div', { className: 'notice notice-warn small' }, [el('strong', { text: 'Not ready: ' }), el('span', { text: ready.reason })]));

  const pageReady = !!state.tab && !!state.page && state.page.page !== 'unknown';
  const onContainerPage = state.page?.page === 'containerCargo';
  const onGridPage = state.page?.page === 'copyContainerDetails';

  if (state.page?.page === 'notificationEmails') section.append(el('p', { className: 'small muted', text: NOTIFICATION_EMAILS_NOTE }));

  if (current.containers.length > 1) {
    const select = el('select', { className: 'select' }) as HTMLSelectElement;
    current.containers.forEach((container, index) => {
      const option = el('option', { text: `${index + 1}. ${container.containerNumber.value || '(no number)'} - seal ${container.carrierSeal.value || '(none)'}`, attrs: { value: String(index) } });
      if (index === state.stored.selectedContainer) option.setAttribute('selected', 'selected');
      select.append(option);
    });
    select.addEventListener('change', () => void store({ ...state.stored, selectedContainer: Number(select.value) }).then(render));
    section.append(el('label', { className: 'field' }, [el('span', { text: 'Container for a single-container fill' }), select]));
  }

  const overwrite = el('input', { attrs: { type: 'checkbox', id: 'overwrite' } });
  section.append(el('label', { className: 'checkbox' }, [overwrite, el('span', { text: 'Overwrite INTTRA fields that already have a different value' })]));

  const fillPage = el('button', { className: 'button button-primary', text: 'Fill Current Page', attrs: { type: 'button', ...(pageReady && ready.ok && !onGridPage ? {} : { disabled: 'disabled' }) } });
  fillPage.addEventListener('click', () => void fill(onContainerPage ? 'container' : 'shipment', false));
  const dryRun = el('button', { className: 'button', text: 'Dry run (write nothing)', attrs: { type: 'button', ...(pageReady && !onGridPage ? {} : { disabled: 'disabled' }) } });
  dryRun.addEventListener('click', () => void fill(onContainerPage ? 'container' : 'shipment', true));
  const actions = [fillPage, dryRun];
  // The live Create Shipping Instruction page repeats a Particulars block per
  // container, numbered from 1 upward, so filling them is a loop and not a
  // choice of one. The single-container fill stays for a correction.
  if (current.containers.length && !onGridPage) {
    const all = el('button', {
      className: 'button button-primary',
      text: `Fill all containers (${current.containers.length})`,
      attrs: { type: 'button', ...(pageReady && ready.ok ? {} : { disabled: 'disabled' }) },
    });
    all.addEventListener('click', () => void fillAllContainers(false));
    const allDry = el('button', { className: 'button', text: 'Dry run all containers', attrs: { type: 'button', ...(pageReady ? {} : { disabled: 'disabled' }) } });
    allDry.addEventListener('click', () => void fillAllContainers(true));
    actions.push(all, allDry);
  }
  section.append(el('div', { className: 'actions' }, actions));

  if (!pageReady) section.append(el('p', { className: 'small warn', text: 'Fill is disabled until an INTTRA Shipping Instructions screen is detected. Use "refresh" in the header after navigating.' }));
  else if (onGridPage) section.append(el('p', { className: 'small muted', text: 'This is the Copy Container Details grid: use the Containers tab.' }));

  const clearHighlights = el('button', { className: 'button button-small', text: 'Clear INTTRA highlighting', attrs: { type: 'button' } });
  clearHighlights.addEventListener('click', () => {
    if (state.tab) void sendToTab(state.tab.id, { type: 'content/clearHighlights' });
  });
  section.append(clearHighlights);
  section.append(el('p', { className: 'small muted', text: 'Every selector shipped in this build is a placeholder until captured from the live portal; a field that does not resolve is reported, never guessed. See Diagnostics.' }));
  if (state.report) section.append(renderReport(state.report));
  for (const report of state.reports ?? []) {
    const container = report.containerIndex === undefined ? null : current.containers[report.containerIndex];
    section.append(
      el('h3', { className: 'small', text: `Container ${(report.containerIndex ?? 0) + 1}${container?.containerNumber.value ? ` - ${container.containerNumber.value}` : ''} (row ${(report.containerIndex ?? 0) + 1} in INTTRA)` }),
      renderReport(report),
    );
  }
  return section;
}

function renderGridReport(report: GridFillReport): HTMLElement {
  const card = el('div', { className: 'card' });
  card.append(
    el('div', { className: 'report-summary' }, [
      el('span', { className: 'pill pill-green', text: `Containers filled: ${report.containersFilled} / ${report.rowsNeeded}` }),
      el('span', { className: 'pill pill-green', text: `Verified cells: ${report.verifiedCells}` }),
      el('span', { className: `pill pill-${report.warnings ? 'yellow' : 'grey'}`, text: `Warnings: ${report.warnings}` }),
      el('span', { className: `pill pill-${report.failed ? 'red' : 'grey'}`, text: `Failed: ${report.failed}` }),
      el('span', { className: `pill pill-${report.unresolved ? 'yellow' : 'grey'}`, text: `Unresolved: ${report.unresolved}` }),
      el('span', { className: 'pill pill-grey', text: `Rows in grid: ${report.rowsAvailable}` }),
    ]),
  );
  for (const message of report.messages) card.append(el('p', { className: 'small warn', text: message }));
  if (report.cells.length) {
    const columns = [...new Set(report.cells.map((cell) => cell.column))];
    const table = el('table', { className: 'grid-table' });
    table.append(el('thead', {}, [el('tr', {}, [el('th', { text: 'Row' }), ...columns.map((column) => el('th', { text: GRID_COLUMNS.find((spec) => spec.key === column)?.label ?? column }))])]));
    const body = el('tbody');
    const rows = [...new Set(report.cells.map((cell) => cell.row))];
    for (const row of rows) {
      body.append(
        el('tr', {}, [
          el('td', { text: String(row) }),
          ...columns.map((column) => {
            const cell = report.cells.find((item) => item.row === row && item.column === column);
            if (!cell) return el('td', { text: '' });
            return el('td', { className: `grid-cell-${cell.status === 'dry-run' ? 'skipped' : cell.status === 'verified' ? 'filled' : cell.status}`, title: cell.message ?? cell.provenance ?? '' }, [
              el('div', { className: 'mono', text: cell.expected || '-' }),
              el('div', { className: 'small muted', text: cell.status === 'verified' ? 'verified' : cell.status }),
            ]);
          }),
        ]),
      );
    }
    table.append(body);
    card.append(el('div', { className: 'diag-container' }, [table]));
  }
  return card;
}

function renderContainers(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Copy Container Details' }),
    el('p', { className: 'small muted', text: 'One grid row per container, container and seals together, every cell read back after it is written. Rows are the ones already in the grid: the helper never presses Add Row, so add the rows in INTTRA first.' }),
  );
  const current = pkg();
  if (!current) {
    section.append(el('p', { className: 'muted', text: 'Load or build a filing package first.' }));
    return section;
  }
  const ready = readyToFill();
  if (!ready.ok) section.append(el('div', { className: 'notice notice-warn small' }, [el('strong', { text: 'Not ready: ' }), el('span', { text: ready.reason })]));

  const preview = el('table', { className: 'grid-table' });
  preview.append(el('thead', {}, [el('tr', {}, GRID_COLUMNS.map((spec) => el('th', { text: spec.label })))]));
  const body = el('tbody');
  for (const container of current.containers) {
    body.append(el('tr', {}, GRID_COLUMNS.map((spec) => el('td', { className: 'mono', text: spec.source === 'containerNumber' ? container.containerNumber.value : container[spec.source].value || '' }))));
  }
  preview.append(body);
  section.append(el('div', { className: 'card' }, [el('strong', { text: `${current.containers.length} row(s) to write` }), el('div', { className: 'diag-container' }, [preview])]));

  const overwrite = el('input', { attrs: { type: 'checkbox', id: 'overwrite-grid' } });
  const anyPage = el('input', { attrs: { type: 'checkbox', id: 'grid-any-page' } });
  section.append(
    el('label', { className: 'checkbox' }, [overwrite, el('span', { text: 'Overwrite cells that already hold a different value' })]),
    el('label', { className: 'checkbox' }, [anyPage, el('span', { text: 'Look for the grid even when the screen was not identified as Copy Container Details' })]),
  );
  const tabReady = !!state.tab;
  // On a click-to-edit grid Fill cannot write a single cell, so the button
  // that works leads. The tab says which grid it has; until it has answered,
  // assume the live portal's, which cannot be typed into.
  const typeable = !!state.grid?.acceptsTyping;
  const fillButton = el('button', { className: `button${typeable ? ' button-primary' : ''}`, text: 'Fill Container Grid', attrs: { type: 'button', ...(tabReady && ready.ok ? {} : { disabled: 'disabled' }) } });
  fillButton.addEventListener('click', () => void fillGrid(false));
  const dry = el('button', { className: 'button', text: 'Dry run (write nothing)', attrs: { type: 'button', ...(tabReady ? {} : { disabled: 'disabled' }) } });
  dry.addEventListener('click', () => void fillGrid(true));
  const copyRowsButton = el('button', { className: `button${typeable ? '' : ' button-primary'}`, text: 'Copy rows', attrs: { type: 'button' } });
  copyRowsButton.addEventListener('click', () => void copyRows());
  section.append(el('div', { className: 'actions' }, typeable ? [fillButton, dry, copyRowsButton] : [copyRowsButton, fillButton, dry]));
  const gridNote = !state.grid
    ? 'The INTTRA tab has not yet said whether its grid can be typed into: open Copy Container Details there and press refresh in the header.'
    : !state.grid.found
      ? 'No container grid is on the INTTRA tab yet. Open Copy Container Details there, then refresh.'
      : typeable
        ? 'The grid on the INTTRA tab can be typed into, so Fill writes it cell by cell and reads every cell back.'
        : 'The grid on the INTTRA tab opens an editor when a cell is clicked, so nothing can be typed into it: Copy rows is the route.';
  section.append(
    el('p', { className: 'small muted', text: gridNote }),
    el('p', { className: 'small muted', text: 'Copy rows asks the INTTRA tab for the grid\'s column order and copies one cell per grid column, blank where the package has nothing for that column. In INTTRA, click the first Container Number cell of the first empty row and paste (Ctrl+V). The helper presses nothing: the paste is yours.' }),
  );
  if (state.gridReport) section.append(renderGridReport(state.gridReport));
  return section;
}

function renderSettings(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Settings' }));
  const numberField = (label: string, value: number, min: number, max: number, onChange: (value: number) => Promise<void>): HTMLElement => {
    const input = el('input', { className: 'input', attrs: { type: 'number', value: String(value), min: String(min), max: String(max) } }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) void onChange(Math.min(Math.max(parsed, min), max));
    });
    return el('label', { className: 'field' }, [el('span', { text: label }), input]);
  };
  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => Promise<void>): HTMLElement => {
    const input = el('input', { attrs: { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) } }) as HTMLInputElement;
    input.addEventListener('change', () => void onChange(input.checked));
    return el('label', { className: 'checkbox' }, [input, el('span', { text: label })]);
  };
  const persist = async (partial: Partial<InttraHelperSettings>): Promise<void> => {
    state.settings = await saveInttraSettings(partial);
    render();
  };
  section.append(
    numberField('Highlight duration (ms)', state.settings.highlightDurationMs, 0, 60000, (value) => persist({ highlightDurationMs: value })),
    checkbox('Dispatch blur after writing (helps fields that validate on blur)', state.settings.dispatchBlur, (value) => persist({ dispatchBlur: value })),
    checkbox('Developer mode (verbose console logging)', state.settings.debugMode, (value) => persist({ debugMode: value })),
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Automation: ' }),
      el('span', { text: 'Add Row, Save, Continue, Submit and login are disabled and there is no setting that enables them. See inttra-extension/src/content/automationPolicy.ts.' }),
    ]),
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Privacy: ' }),
      el('span', { text: 'Settings are stored locally in this browser profile. The package, the extraction and the session log are held in session memory only and dropped when the browser closes or you click Clear Data. Nothing is sent anywhere; the extension has no network permission.' }),
    ]),
  );
  return section;
}

function renderCaptureChecklist(): HTMLElement {
  const card = el('details', { className: 'card' }, [el('summary', {}, [el('strong', { text: 'What to capture from INTTRA DevTools' })])]);
  card.append(el('p', { className: 'small muted', text: 'Every selector in this build is a placeholder. Capture these with Chrome DevTools (right-click -> Inspect -> right-click the element -> Copy -> Copy outerHTML), paste them into a file, and the mappings can be made exact. Never mark a selector verified that was not read off the live portal.' }));
  const list = el('ol', { className: 'small capture-list' });
  for (const signature of INTTRA_PAGE_SIGNATURES) list.append(el('li', {}, [el('strong', { text: `${signature.label}: ` }), el('span', { text: signature.captureHint })]));
  list.append(el('li', {}, [el('strong', { text: 'Copy Container Details grid, in this order: ' }), el('ol', { className: 'small' }, GRID_DEVTOOLS_CHECKLIST.map((item) => el('li', { text: item })))]));
  list.append(el('li', {}, [el('strong', { text: 'The address bar: ' }), el('span', { text: 'the exact hostname of the Shipping Instructions screens, to confirm the two host patterns in the manifest.' })]));
  card.append(list);
  return card;
}

function renderDetection(snapshot: InttraDiagnosticsSnapshot): HTMLElement {
  const container = el('div', { className: 'diag-container' });
  container.append(
    el('div', { className: 'diag-head' }, [
      el('div', {}, [el('span', { className: 'label', text: 'Current INTTRA screen: ' }), el('strong', { text: snapshot.page.label }), el('span', { className: `pill pill-${snapshot.page.confidence === 'high' ? 'green' : snapshot.page.confidence === 'none' ? 'red' : 'yellow'}`, text: `confidence: ${snapshot.page.confidence}` })]),
      el('div', { className: 'muted small', text: snapshot.url }),
    ]),
    el('details', { className: 'diag-block' }, [el('summary', { text: 'Page detection evidence' }), el('ul', { className: 'small' }, snapshot.page.evidence.map((line) => el('li', { text: line }))), el('ul', { className: 'small muted' }, snapshot.page.scores.map((score) => el('li', { text: `${score.page}: score ${score.score}` })))]),
  );
  // The grid lives in the Copy Container Details modal and nowhere else, so
  // "not found" is the ordinary answer on every other screen, not a fault.
  // Listing all nine columns as unidentified when there is no grid at all
  // reads like a failure, so that list is shown only when a grid was found.
  const grid = snapshot.grid;
  container.append(
    el('div', { className: 'diag-block' }, [
      el('div', {}, [
        el('span', { className: 'label', text: 'Container grid: ' }),
        el('span', { className: `pill pill-${grid.found ? 'green' : 'grey'}`, text: grid.found ? `found (${grid.kind}), ${grid.rowCount} row(s)` : 'none on this screen' }),
      ]),
      grid.found
        ? null
        : el('div', { className: 'small muted', text: 'The grid exists only inside Copy Container Details. Open it from "Copy container details from spreadsheet" in Particulars, wait for the rows to draw, then press refresh in the header. Everything below is what was tried.' }),
      grid.matchedWith ? el('div', { className: 'small', text: `Root matched by ${grid.matchedWith}` }) : null,
      grid.headers.length ? el('ul', { className: 'small mono' }, grid.headers.map((header) => el('li', { text: `col ${header.index}: "${header.text}" -> ${header.column ?? '(not identified)'}${header.options ? ` (dropdown: ${header.options.join(' | ')})` : ''}` }))) : null,
      grid.found && grid.missingColumns.length ? el('div', { className: 'small warn', text: `Columns not identified: ${grid.missingColumns.join(', ')}` }) : null,
      el('ol', { className: 'small mono' }, grid.attempts.map((attempt) => el('li', { text: `${attempt.query} -> ${attempt.matches} match(es)${attempt.raw !== undefined && attempt.raw !== attempt.matches ? ` (of ${attempt.raw} in the DOM)` : ''}` }))),
    ]),
  );
  // What the document is built from, for the capture: which frame answered,
  // which markers are there, and what surrounds the words "Container Number".
  // An older content script answers without it.
  const structure = snapshot.structure;
  if (structure) {
    container.append(
      el('details', { className: 'diag-block' }, [
        el('summary', { text: 'Page structure (for the capture)' }),
        el('div', { className: 'small', text: `Answered by ${structure.topFrame ? 'the top frame' : 'a child frame'}; frames inside it: ${structure.frames.length ? structure.frames.join(', ') : 'none'}.` }),
        el('ul', { className: 'small mono' }, structure.markers.map((marker) => el('li', { text: `${marker.selector}: ${marker.state}` }))),
        structure.containerNumber.length
          ? el(
              'ol',
              { className: 'small mono' },
              structure.containerNumber.map((found) =>
                el('li', {}, [
                  el('div', { text: `"${found.text}"${found.visible ? '' : ' (hidden)'} in ${found.ancestors.join(' < ')}` }),
                  ...found.rows.map((row) => el('div', { text: `row at level ${row.level}, ${row.row}: ${row.cells.map((cell) => `"${cell}"`).join(' | ')}` })),
                ]),
              ),
            )
          : el('div', { className: 'small warn', text: 'The words "Container Number" appear nowhere as text in this document.' }),
      ]),
    );
  }
  const list = el('div', { className: 'diag-fields' });
  for (const field of snapshot.fields) {
    const detection = field.detection;
    list.append(
      el('details', { className: 'diag-field' }, [
        el('summary', {}, [el('span', { className: 'diag-key', text: field.key }), el('span', { className: `pill pill-${detection.status === 'FOUND' ? 'green' : detection.status === 'NOT_WRITABLE' ? 'yellow' : 'red'}`, text: detection.status }), field.verificationStatus === 'placeholder' ? el('span', { className: 'pill pill-grey', text: 'selector unverified' }) : null]),
        el('div', { className: 'diag-body' }, [
          el('div', { className: 'small', text: `${field.label} (${field.scope}${field.scope === 'container' ? ', probed on row 1' : ''})` }),
          detection.matchedWith ? el('div', { className: 'small' }, [el('code', { text: `${detection.matchedBy ?? '?'} -> ${detection.matchedWith}` }), el('span', { className: 'muted', text: ` (confidence ${detection.confidence})` })]) : null,
          el('ol', { className: 'small mono' }, detection.attempts.map((attempt) => el('li', { text: `[${attempt.strategy}${attempt.verified ? ', verified' : ''}] ${attempt.query} -> ${attempt.matches} match(es)` }))),
          field.devtoolsHint && detection.status !== 'FOUND' ? el('div', { className: 'hint-box small' }, [el('strong', { text: 'Capture: ' }), el('span', { text: field.devtoolsHint })]) : null,
        ]),
      ]),
    );
  }
  container.append(list);
  return container;
}

function renderSelectorEditor(): HTMLElement {
  const card = el('details', { className: 'card' });
  const captured = Object.keys(state.overrides.fields);
  card.append(
    el('summary', {}, [el('strong', { text: 'INTTRA selectors' }), el('span', { className: `pill pill-${captured.length ? 'green' : 'yellow'}`, text: captured.length ? `${captured.length} captured` : `${unverifiedInttraFieldKeys().length} placeholders` })]),
    el('p', { className: 'small muted', text: 'Paste captured selectors here as JSON. They are tried first, take effect on the next fill, and need no rebuild. Same format as the ACE Helper.' }),
  );
  const unresolved = state.diagnostics ? state.diagnostics.fields.filter((field) => field.detection.status !== 'FOUND').map((field) => field.key) : [];
  const draft = state.overridesDraft ?? (captured.length ? serializeOverrides(state.overrides) : serializeOverrides(starterOverrides(ALL_INTTRA_MAPPINGS, unresolved, 'INTTRA')));
  const textarea = el('textarea', { className: 'input mono textarea', attrs: { rows: '12', spellcheck: 'false' } }) as HTMLTextAreaElement;
  textarea.value = draft;
  textarea.addEventListener('input', () => {
    state.overridesDraft = textarea.value;
  });
  card.append(el('label', { className: 'field' }, [el('span', { text: 'Selector overrides (JSON)' }), textarea]));
  const save = el('button', { className: 'button button-primary', text: 'Save selectors', attrs: { type: 'button' } });
  save.addEventListener('click', () => {
    void (async () => {
      try {
        state.overrides = await saveInttraOverrides(textarea.value, document);
        state.overridesDraft = null;
        await appendLog('selectors', `Selector overrides saved: ${Object.keys(state.overrides.fields).length} field(s).`);
        await refreshLog();
        setStatus('Selectors saved. They take effect on the next fill; reload the INTTRA tab if it was already open.', 'ok');
      } catch (error) {
        setStatus((error as Error).message, 'error');
      }
      render();
    })();
  });
  const exportButton = el('button', { className: 'button button-small', text: 'Export', attrs: { type: 'button' } });
  exportButton.addEventListener('click', () => downloadText(serializeOverrides(state.overrides), 'inttra-selectors.json'));
  const reset = el('button', { className: 'button button-small button-danger', text: 'Remove all', attrs: { type: 'button' } });
  reset.addEventListener('click', () => {
    void (async () => {
      await clearInttraOverrides();
      state.overrides = emptyOverrides();
      state.overridesDraft = null;
      setStatus('Selector overrides removed.', 'ok');
      render();
    })();
  });
  card.append(el('div', { className: 'actions' }, [save, exportButton, reset]));
  return card;
}

function buildDiagnosticsDocument(): string {
  const lines: string[] = ['INTTRA Helper diagnostics', `Generated ${new Date().toISOString()}`, 'This file was written on this machine and uploaded nowhere.', ''];
  const current = pkg();
  lines.push(current ? `Package        ${current.packageId} (${current.containers.length} container(s), Deckhand ${current.review.deckhand})` : 'No package loaded.');
  lines.push(`INTTRA tab     ${state.tab ? state.tab.url : '(none open)'}`);
  lines.push(`INTTRA screen  ${state.page ? `${state.page.label} (${state.page.confidence})` : '(not detected)'}`);
  lines.push(`Selectors      ${Object.keys(state.overrides.fields).length} operator-captured, ${unverifiedInttraFieldKeys().length} of ${ALL_INTTRA_MAPPINGS.length} built-in still placeholders`);
  lines.push('', 'Session log', formatLog(state.log), '');
  if (state.diagnostics) lines.push('Detection snapshot (JSON)', JSON.stringify(state.diagnostics, null, 2));
  if (state.gridReport) lines.push('', 'Last grid report (JSON)', JSON.stringify(state.gridReport, null, 2));
  return lines.join('\n');
}

function renderDiagnosticsTab(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Diagnostics' }));
  const run = el('button', { className: 'button', text: 'Run detection on the INTTRA tab', attrs: { type: 'button' } });
  run.addEventListener('click', () => void runDiagnostics());
  const copy = el('button', { className: 'button button-small', text: 'Copy diagnostics', attrs: { type: 'button' } });
  copy.addEventListener('click', () => copyToClipboard(buildDiagnosticsDocument(), 'Diagnostics'));
  const exportButton = el('button', { className: 'button button-small', text: 'Export diagnostics', attrs: { type: 'button' } });
  exportButton.addEventListener('click', () => downloadText(buildDiagnosticsDocument(), `inttra-helper-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`));
  section.append(el('div', { className: 'actions' }, [run, copy, exportButton]));
  section.append(renderCaptureChecklist());
  section.append(renderSelectorEditor());
  section.append(
    el('details', { className: 'card', attrs: state.diagnostics ? { open: 'open' } : {} }, [
      el('summary', { text: 'Detection' }),
      state.diagnostics ? renderDetection(state.diagnostics) : el('p', { className: 'muted small', text: 'Run detection on an open INTTRA screen to see what resolves.' }),
    ]),
  );
  const logCard = el('details', { className: 'card' }, [el('summary', { text: `Session log (${state.log.length} entries, memory only)` })]);
  logCard.append(el('ul', { className: 'log-list small mono' }, state.log.slice().reverse().map((entry) => el('li', { className: `log log-${entry.kind}` }, [el('span', { className: 'log-time', text: new Date(entry.at).toTimeString().slice(0, 8) }), el('span', { className: 'log-kind', text: entry.kind }), el('span', { text: entry.message }), entry.detail ? el('div', { className: 'log-detail muted', text: entry.detail }) : null]))));
  section.append(logCard);
  const savePkg = el('button', { className: 'button button-small', text: 'Save the loaded package as JSON', attrs: { type: 'button' } });
  savePkg.addEventListener('click', () => {
    const current = pkg();
    if (current) downloadText(serializeFilingPackage(current), filingPackageFileName(current));
  });
  if (pkg()) section.append(savePkg);
  return section;
}

// -------------------------------------------------------------------- render

function render(): void {
  const root = byId('root');
  clear(root);
  root.append(renderHeader(), renderTabs(), el('div', { className: 'status', attrs: { id: 'status' } }));
  switch (state.activeTab) {
    case 'overview':
      root.append(renderOverview());
      break;
    case 'import':
      root.append(renderImport());
      break;
    case 'deckhand':
      root.append(renderDeckhand());
      break;
    case 'package':
      root.append(renderPackage());
      break;
    case 'containers':
      root.append(renderContainers());
      break;
    case 'settings':
      root.append(renderSettings());
      break;
    case 'diagnostics':
      root.append(renderDiagnosticsTab());
      break;
    case 'fill':
    default:
      root.append(renderFill());
      break;
  }
  if (state.surface === 'popup') {
    const open = openPanelButton('Open full panel (import, Deckhand, package, diagnostics)');
    open.classList.add('button-small');
    root.append(el('footer', { className: 'app-footer' }, [open]));
  }
  renderStatus();
}

export async function startApp(surface: Surface): Promise<void> {
  state.surface = surface;
  state.activeTab = surface === 'panel' ? 'import' : 'overview';
  render();
  state.settings = await loadInttraSettings();
  state.overrides = await loadInttraOverrides();
  await refreshStored();
  await refreshLog();
  await refreshTab();
  if (state.stored.package) state.activeTab = 'overview';
  render();
}
