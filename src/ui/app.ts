/**
 * Shared extension UI.
 *
 * Rendered into both surfaces:
 *   - popup  : quick actions against the ACE tab (overview, fill, preview).
 *   - panel  : the full workspace - import, preview, mapping status, fill,
 *              calculator, settings, diagnostics.
 *
 * Import lives in the panel because Chrome closes an extension popup when a
 * file picker opens; the popup links to the panel instead.
 *
 * Safety invariants enforced here:
 *   - nothing is sent to ACE without an explicit button click;
 *   - no button in this UI saves, submits, or certifies an ACE filing;
 *   - nothing is uploaded: "copy" writes to the clipboard and "export" writes
 *     a file the user chose to download. See src/content/automationPolicy.ts.
 */

import type { FillReport } from '../models/AceField.js';
import type { DiagnosticsSnapshot, StoredImport } from '../core/messages.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AceHelperSettings } from '../core/settings.js';
import {
  DEFAULT_COUNTER,
  formatReference,
  loadCounter,
  markFiled,
  nextReference,
  reserve,
  saveCounter,
  setNextReference,
  type ReferenceCounter,
} from '../core/referenceCounter.js';
import { formatLog, type SessionLogEntry, type SessionLogKind } from '../core/sessionLog.js';
import type { MapperNote } from '../excel/canonicalMapper.js';
import type { ExcelImporter, OpenedWorkbook } from './importer.js';
import { buildPreview, summarize, type PreviewCell } from './preview.js';
import { buildPreflight, summarizePreflight, type PreflightResult } from './preflight.js';
import {
  applyFillReport,
  buildMappingStatus,
  formatMappingStatus,
  summarizeMappingStatus,
  type MappingStatusRow,
} from './mappingStatus.js';
import { renderCalculatorPanel } from './calculatorPanel.js';
import { renderDiagnostics } from './diagnostics.js';
import { appendAll, byId, clear, el, show, buildStamp } from './dom.js';
import { resolveAceTab, sendToBackground, sendToTab, type AceTab } from './tabs.js';
import type { PageDetection } from '../content/pageDetector.js';
import { ALL_MAPPINGS, unverifiedFieldKeys } from '../ace/mappings/index.js';
import {
  emptyOverrides,
  serializeOverrides,
  starterOverrides,
  type SelectorOverrides,
} from '../ace/selectors/overrides.js';
import { clearOverrides, loadOverrides, saveOverrides } from '../ace/selectors/overridesStore.js';
import { renderDeckhandTab, type DeckhandState } from './deckhandTab.js';
import { renderPackageTab } from './packageTab.js';
import { buildFilingPackage, aceShipmentFromPackage, type CommercialSource, type FilingPackage } from '../../shared/src/index.js';
import { validateShipment } from '../excel/validator.js';

export type Surface = 'popup' | 'panel';

type StatusTone = 'info' | 'ok' | 'warn' | 'error';

interface AppState {
  surface: Surface;
  settings: AceHelperSettings;
  /** The filer's running Shipment Reference Number. See src/core/referenceCounter.ts. */
  counter: ReferenceCounter;
  data: StoredImport | null;
  workbook: OpenedWorkbook | null;
  aceTab: AceTab | null;
  page: PageDetection | null;
  report: FillReport | null;
  diagnostics: DiagnosticsSnapshot | null;
  status: { text: string; tone: StatusTone } | null;
  activeTab: string;
  /** True while a workbook is being read, so the file input can be disabled. */
  busy: boolean;
  /** Mapping status rows, rebuilt on import and refined by a dry run. */
  mapping: MappingStatusRow[];
  /** True once a dry run against the open ACE page has been folded in. */
  mappingChecked: boolean;
  log: SessionLogEntry[];
  overrides: SelectorOverrides;
  /** Text in the selector-override editor, kept across re-renders. */
  overridesDraft: string | null;
  /** The Deckhand extraction being reviewed. Mirrored into the stored import when one is loaded. */
  deckhand: DeckhandState | null;
  /** Text in the Deckhand paste box, kept across re-renders. */
  deckhandDraft: string;
}

/** Injected by the panel surface only; the popup has no Import tab. */
let importer: ExcelImporter | null = null;

const state: AppState = {
  surface: 'popup',
  settings: { ...DEFAULT_SETTINGS },
  counter: { ...DEFAULT_COUNTER },
  data: null,
  workbook: null,
  aceTab: null,
  page: null,
  report: null,
  diagnostics: null,
  status: null,
  activeTab: 'overview',
  busy: false,
  mapping: [],
  mappingChecked: false,
  log: [],
  overrides: emptyOverrides(),
  overridesDraft: null,
  deckhand: null,
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

function dot(status: 'green' | 'yellow' | 'red'): HTMLElement {
  return el('span', { className: `dot dot-${status}`, attrs: { 'aria-hidden': 'true' } });
}

function statusWord(status: 'green' | 'yellow' | 'red'): string {
  return status === 'green' ? 'valid' : status === 'yellow' ? 'check' : 'invalid';
}

function tick(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
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

/**
 * Save text as a file.
 *
 * A Blob URL and an anchor click, entirely inside the extension page: nothing
 * is uploaded and no network permission is involved. The URL is revoked
 * immediately so the data does not sit in memory after the save dialog.
 */
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

// ------------------------------------------------------------------ loading

async function refreshData(): Promise<void> {
  const response = await sendToBackground({ type: 'store/get' });
  state.data = response.ok && response.type === 'store/data' ? response.payload : null;
  if (state.data?.deckhand) state.deckhand = state.data.deckhand;
  rebuildMapping();
}

/** Store a new version of the import and keep the mapping in step. */
async function storeData(next: StoredImport): Promise<void> {
  const response = await sendToBackground({ type: 'store/set', payload: next });
  state.data = response.ok && response.type === 'store/data' ? response.payload : next;
  rebuildMapping();
}

function rebuildMapping(): void {
  if (!state.data) {
    state.mapping = [];
    state.mappingChecked = false;
    return;
  }
  state.mapping = buildMappingStatus(state.data.shipment, {
    settings: state.settings,
    line: state.data.selectedLine,
    source: state.data.source,
  });
  state.mappingChecked = false;
}

async function refreshAceTab(): Promise<void> {
  state.aceTab = await resolveAceTab();
  state.page = null;
  if (!state.aceTab) return;
  const response = await sendToTab(state.aceTab.id, { type: 'content/detectPage' });
  if (response.ok && response.type === 'content/page') state.page = response.payload;
}

function preflight(): PreflightResult | null {
  if (!state.data) return null;
  return buildPreflight(state.data.shipment, state.data.validation, state.data.notes);
}

// -------------------------------------------------------------------- import

async function onFileChosen(file: File): Promise<void> {
  if (!importer) {
    setStatus('Import is only available in the ACE Helper panel.', 'warn');
    return;
  }

  state.busy = true;
  setStatus(`Reading ${file.name}...`, 'info');

  const opened = await importer.openFile(file);
  if (!opened.ok) {
    state.workbook = null;
    state.busy = false;
    setStatus(opened.error, 'error');
    render();
    return;
  }

  state.workbook = opened.value;
  const firstSheet = opened.value.kind === 'package' ? '' : (opened.value.sheetNames[0] as string);
  await importSheet(firstSheet);
  state.busy = false;
  render();
}

async function importSheet(sheetName: string): Promise<void> {
  if (!importer || !state.workbook) return;

  const result = importer.importSheet(sheetName, state.settings);
  if (!result.ok) {
    setStatus(result.error, 'error');
    render();
    return;
  }

  const payload = result.value;
  // A workbook import keeps the Deckhand extraction already on screen; a
  // package import brings its own.
  if (payload.package) state.deckhand = payload.deckhand ?? null;
  else if (state.deckhand) payload.deckhand = state.deckhand;
  await storeData(payload);
  state.report = null;

  const source = payload.source;
  await appendLog(
    'import',
    `Loaded ${payload.shipment.source.fileName} - ${payload.shipment.commodities.length} line(s)${sheetName ? ` from "${sheetName}"` : ''}${source ? ` via ${source.label}` : ''}.`,
    source?.detail,
  );
  // The transformations are the part somebody will want to trace later, so
  // each one gets its own line rather than being summarised away.
  for (const commodity of payload.shipment.commodities) {
    const records = payload.shipment.provenance.commodities[commodity.line] ?? {};
    for (const [field, record] of Object.entries(records)) {
      if (!record.transform) continue;
      await appendLog('transform', `Line ${commodity.line} ${field}: ${record.original} -> ${record.normalized}`, record.transform);
    }
  }
  await refreshLog();

  state.activeTab = payload.package ? 'package' : 'preview';
  setStatus(
    `Imported ${payload.shipment.commodities.length} line(s)${sheetName ? ` from "${sheetName}"` : ` from ${payload.shipment.source.fileName}`} - ${summarize(payload.validation, payload.shipment.commodities.length)}. Nothing has been written to ACE yet.`,
    payload.validation.errors ? 'warn' : 'ok',
  );
}

async function clearData(): Promise<void> {
  await sendToBackground({ type: 'store/clear' });
  state.data = null;
  state.workbook = null;
  state.report = null;
  state.mapping = [];
  state.mappingChecked = false;
  state.deckhand = null;
  importer?.reset();
  if (state.aceTab) await sendToTab(state.aceTab.id, { type: 'content/clearHighlights' });
  await refreshLog();
  setStatus('Imported data cleared from memory, along with the session log that held values from it.', 'ok');
  render();
}

// ---------------------------------------------------------------------- fill

async function fill(scope: 'shipment' | 'commodityLine', dryRun: boolean): Promise<void> {
  if (!state.data) {
    setStatus('Import a spreadsheet first.', 'warn');
    return;
  }
  await refreshAceTab();
  if (!state.aceTab) {
    setStatus('No ACE tab is open. Open your ACE filing, then try again.', 'error');
    render();
    return;
  }
  if (!state.page || state.page.page === 'unknown') {
    setStatus(
      'The ACE page could not be identified, so nothing was filled. Navigate to a filing step (Shipment, Parties, Commodities, Transportation) and refresh.',
      'error',
    );
    render();
    return;
  }

  const overwrite = (document.getElementById('overwrite') as HTMLInputElement | null)?.checked ?? false;

  // Recorded before the write, so the log says what was known at the time.
  const check = preflight();
  if (!dryRun && check) await appendLog('note', summarizePreflight(check));

  // Filling Step 1 takes the next reference and holds it. The sequence does
  // not advance until "Mark as filed", so an abandoned draft leaves no gap.
  if (!dryRun && scope === 'shipment' && state.counter.configured) {
    state.counter = await saveCounter(reserve(state.counter));
  }

  const response = await sendToTab(state.aceTab.id, {
    type: 'content/fill',
    scope,
    ...(scope === 'commodityLine' ? { line: state.data.selectedLine } : {}),
    shipment: state.data.shipment,
    settings: state.settings,
    ...(dryRun ? { dryRun: true } : {}),
    ...(overwrite ? { overwrite: true } : {}),
    ...(state.counter.configured ? { operator: { shipmentReference: formatReference(nextReference(state.counter)) } } : {}),
  });

  if (!response.ok) {
    setStatus(response.error, 'error');
    render();
    return;
  }
  if (response.type !== 'content/fillReport') return;

  state.report = response.payload;
  state.mapping = applyFillReport(state.mapping, response.payload);
  state.mappingChecked = true;
  await refreshLog();

  const { filled, skipped, warnings, errors } = response.payload;
  const prefix = dryRun ? 'Dry run (nothing written)' : 'Done';
  setStatus(
    `${prefix}: filled ${filled}, skipped ${skipped}, warnings ${warnings}${errors ? `, errors ${errors}` : ''}. Review every value in ACE before you submit.`,
    errors ? 'error' : warnings ? 'warn' : 'ok',
  );
  render();
}

/** Resolve the mapping table against the open ACE page, writing nothing. */
async function checkMappingAgainstPage(): Promise<void> {
  if (!state.data) return;
  await refreshAceTab();
  if (!state.aceTab || !state.page || state.page.page === 'unknown') {
    setStatus('Open an ACE filing step in another tab, then check again.', 'warn');
    render();
    return;
  }

  for (const scope of ['shipment', 'commodityLine'] as const) {
    const response = await sendToTab(state.aceTab.id, {
      type: 'content/fill',
      scope,
      ...(scope === 'commodityLine' ? { line: state.data.selectedLine } : {}),
      shipment: state.data.shipment,
      settings: state.settings,
      dryRun: true,
      ...(state.counter.configured ? { operator: { shipmentReference: formatReference(nextReference(state.counter)) } } : {}),
    });
    if (response.ok && response.type === 'content/fillReport') {
      state.mapping = applyFillReport(state.mapping, response.payload);
    }
  }

  state.mappingChecked = true;
  await refreshLog();
  const summary = summarizeMappingStatus(state.mapping.filter((row) => row.page === state.page?.page));
  setStatus(
    `Checked against ${state.page.label}: ${summary.ready} ready, ${summary.review} to review, ${summary.blocked} blocked. Nothing was written.`,
    summary.blocked ? 'warn' : 'ok',
  );
  render();
}

async function runDiagnostics(): Promise<void> {
  await refreshAceTab();
  if (!state.aceTab) {
    setStatus('No ACE tab is open.', 'error');
    render();
    return;
  }
  const response = await sendToTab(state.aceTab.id, { type: 'content/diagnostics' });
  if (!response.ok) {
    setStatus(response.error, 'error');
  } else if (response.type === 'content/diagnostics') {
    state.diagnostics = response.payload;
    setStatus('Diagnostics refreshed.', 'ok');
  }
  await refreshLog();
  render();
}

async function revealField(key: string): Promise<void> {
  if (!state.aceTab) return;
  const response = await sendToTab(state.aceTab.id, { type: 'content/revealField', key });
  if (response.ok && response.type === 'content/revealed' && !response.found) {
    setStatus(`Field "${key}" is not highlighted on the ACE page (it may not have been written).`, 'warn');
    renderStatus();
  }
}

async function selectLine(line: number): Promise<void> {
  const response = await sendToBackground({ type: 'store/selectLine', line });
  if (response.ok && response.type === 'store/data') state.data = response.payload;
  rebuildMapping();
  render();
}

// ------------------------------------------------------------------ sections

function renderHeader(): HTMLElement {
  const page = state.page;
  const tone = !state.aceTab ? 'grey' : page && page.page !== 'unknown' ? (page.confidence === 'high' ? 'green' : 'yellow') : 'red';
  const text = !state.aceTab
    ? 'No ACE tab detected'
    : page && page.page !== 'unknown'
      ? `${page.label} (${page.confidence} confidence)`
      : 'ACE page not identified';

  const stamp = buildStamp();
  return el('header', { className: 'app-header' }, [
    el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'ACE' }),
      el('span', { className: 'brand-name', text: 'Helper' }),
      stamp ? el('span', { className: 'build-stamp', text: stamp, title: 'The build this helper is running: version, git commit, build time (UTC)' }) : null,
    ]),
    el('div', { className: 'page-chip' }, [el('span', { className: `pill pill-${tone}`, text }), buildRefreshButton()]),
  ]);
}

function buildRefreshButton(): HTMLElement {
  const button = el('button', { className: 'link-button', text: 'refresh', attrs: { type: 'button' } });
  button.addEventListener('click', () => {
    void (async () => {
      await refreshAceTab();
      render();
    })();
  });
  return button;
}

function renderTabs(): HTMLElement {
  const tabs: Array<{ id: string; label: string }> =
    state.surface === 'panel'
      ? [
          { id: 'overview', label: 'Overview' },
          { id: 'import', label: 'Import' },
          { id: 'deckhand', label: 'Deckhand' },
          { id: 'package', label: 'Package' },
          { id: 'preview', label: 'Preview' },
          { id: 'mapping', label: 'Mapping' },
          { id: 'fill', label: 'Fill ACE' },
          { id: 'calculator', label: 'Calculator' },
          { id: 'settings', label: 'Settings' },
          { id: 'diagnostics', label: 'Diagnostics' },
        ]
      : [
          { id: 'overview', label: 'Overview' },
          { id: 'fill', label: 'Fill ACE' },
          { id: 'preview', label: 'Preview' },
        ];

  if (!tabs.some((tab) => tab.id === state.activeTab)) state.activeTab = tabs[0]?.id ?? 'overview';

  const nav = el('nav', { className: 'tabs', attrs: { role: 'tablist' } });
  for (const tab of tabs) {
    const button = el('button', {
      className: `tab${state.activeTab === tab.id ? ' tab-active' : ''}`,
      text: tab.label,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(state.activeTab === tab.id) },
    });
    button.addEventListener('click', () => {
      state.activeTab = tab.id;
      render();
    });
    nav.append(button);
  }
  return nav;
}

function goTo(tab: string): void {
  state.activeTab = tab;
  render();
}

function actionButton(label: string, tab: string, primary = false): HTMLElement {
  const button = el('button', {
    className: `button${primary ? ' button-primary' : ''}`,
    text: label,
    attrs: { type: 'button' },
  });
  button.addEventListener('click', () => goTo(tab));
  return button;
}

/**
 * The home screen: what is loaded, whether it is ready, and the five things
 * an operator does. Everything else is a tab away.
 */
function renderOverview(): HTMLElement {
  const section = el('section', { className: 'panel-section' });

  // ---- Invoice -----------------------------------------------------------
  section.append(el('h2', { text: 'Invoice' }));
  if (!state.data) {
    section.append(
      el('p', { className: 'muted', text: 'Nothing loaded. Import an ACE workbook, or export one from QuickBooks first.' }),
      state.surface === 'panel' ? actionButton('Import a workbook', 'import', true) : buildOpenPanelButton('Open the panel to import'),
      // The sequence is the filer's own, not the workbook's, and seeding it is
      // a first-run act. Hiding it until an import would mean the first filing
      // is the earliest it can be set, which is a filing too late.
      referenceCounterBlock(),
    );
    return section;
  }

  const { shipment, validation, source } = state.data;
  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'invoice-number', text: shipment.invoice.invoiceNumber || '(no invoice number)' }),
      el('div', { text: shipment.invoice.customerName || '(no customer)' }),
      el('div', { className: 'small muted', text: `${shipment.source.fileName} - ${shipment.commodities.length} commodity line(s)` }),
      source ? el('div', { className: 'small muted', text: `Source: ${source.label} - ${source.detail}` }) : null,
    ]),
  );

  // ---- Status ------------------------------------------------------------
  const check = preflight();
  const summary = summarizeMappingStatus(state.mapping);
  const lines: Array<{ status: 'pass' | 'warn' | 'fail'; text: string }> = [
    { status: 'pass', text: `${source?.label ?? 'Workbook'} loaded` },
    {
      status: summary.ready + summary.review > 0 ? 'pass' : 'warn',
      text: `${summary.total - summary.blocked} of ${summary.total} ACE fields mapped${state.mappingChecked ? ' and found on the ACE page' : ''}`,
    },
  ];
  if (summary.review) lines.push({ status: 'warn', text: `${summary.review} field(s) require review` });
  if (summary.blocked) lines.push({ status: 'fail', text: `${summary.blocked} field(s) cannot be filled` });
  if (check && !check.ready) {
    lines.push({ status: 'fail', text: `${check.blocking.length} data quality error(s) - see Fill ACE` });
  } else if (check && check.warnings.length) {
    lines.push({ status: 'warn', text: `${check.warnings.length} data quality warning(s)` });
  }
  if (state.deckhand) {
    lines.push({
      status: state.deckhand.approvedAt ? 'pass' : 'warn',
      text: state.deckhand.approvedAt ? 'Deckhand extraction approved' : 'Deckhand extraction awaiting review',
    });
  }
  if (state.data.package) {
    lines.push({ status: 'pass', text: `Filing package ${state.data.package.packageId} built` });
  }
  if (!state.aceTab) lines.push({ status: 'warn', text: 'No ACE tab open' });

  section.append(
    el('h2', { text: 'Status' }),
    el(
      'ul',
      { className: 'status-list' },
      lines.map((line) =>
        el('li', { className: `status-line status-${line.status}` }, [
          el('span', { className: 'status-mark', text: tick(line.status) }),
          el('span', { text: line.text }),
        ]),
      ),
    ),
    el('p', { className: 'small muted', text: summarize(validation, shipment.commodities.length) }),
  );

  section.append(referenceCounterBlock());

  // ---- Actions -----------------------------------------------------------
  const actions = el('div', { className: 'actions actions-grid' });
  actions.append(actionButton('Preview', 'preview'));
  if (state.surface === 'panel') actions.append(actionButton('Mapping status', 'mapping'));
  actions.append(actionButton('Fill Current Page', 'fill', true));
  actions.append(actionButton('Fill Current Line', 'fill'));
  if (state.surface === 'panel') actions.append(actionButton('Calculator', 'calculator'));

  const clearButton = el('button', {
    className: 'button button-danger',
    text: 'Clear Data',
    attrs: { type: 'button', title: 'Removes the shipment and the session log from memory. Export diagnostics first if you want the trail.' },
  });
  clearButton.addEventListener('click', () => void clearData());
  actions.append(clearButton);

  section.append(el('h2', { text: 'Actions' }), actions);

  // ---- Diagnostics -------------------------------------------------------
  if (state.surface === 'panel') {
    section.append(
      el('h2', { text: 'Diagnostics' }),
      el('p', { className: 'small muted', text: 'Field detection, the session log, and the ACE selector table.' }),
      actionButton('Open', 'diagnostics'),
    );
  }

  return section;
}

function renderImport(): HTMLElement {
  const section = el('section', { className: 'panel-section' });

  if (!importer) {
    appendAll(
      section,
      el('h2', { text: 'Import' }),
      el('p', { className: 'muted', text: 'Chrome closes an extension popup when a file picker opens, so importing happens in the panel.' }),
      buildOpenPanelButton('Open the panel to import'),
    );
    return section;
  }

  section.append(
    el('h2', { text: 'Import' }),
    el('p', { className: 'muted small', text: 'The workbook is parsed in this browser. Nothing is uploaded anywhere.' }),
    el('p', { className: 'small muted', text: 'Two kinds of workbook are recognised: one you filled in from the template, and one the QuickBooks companion wrote. Both are read exactly the same way; only the label differs. A filing-package.json (from the Package tab, the INTTRA Helper, or "ace-export package") is accepted too.' }),
  );

  const fileInput = el('input', {
    className: 'file-input',
    attrs: { type: 'file', accept: '.xlsx,.xlsm,.xltx,.json', id: 'file-input', ...(state.busy ? { disabled: 'disabled' } : {}) },
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void onFileChosen(file);
  });

  section.append(el('label', { className: 'field' }, [el('span', { text: 'Workbook (.xlsx) or filing package (.json)' }), fileInput]));
  section.append(buildDropZone());

  const templateLink = el('a', {
    className: 'link',
    text: 'Download the import template',
    attrs: { href: chrome.runtime.getURL('templates/ACE_Import_Template.xlsx'), download: 'ACE_Import_Template.xlsx' },
  });
  section.append(el('p', { className: 'small' }, [templateLink]));

  if (state.workbook) {
    section.append(
      el('div', { className: 'card small' }, [
        el('strong', { text: state.workbook.source.label }),
        el('span', { className: 'muted', text: ` - ${state.workbook.source.detail}` }),
      ]),
    );
  }

  if (state.workbook && state.workbook.sheetNames.length > 1) {
    const select = el('select', { className: 'select', attrs: { id: 'sheet-select' } });
    for (const name of state.workbook.sheetNames) {
      const option = el('option', { text: name, attrs: { value: name } });
      if (state.data?.shipment.source.sheetName === name) option.setAttribute('selected', 'selected');
      select.append(option);
    }
    select.addEventListener('change', () => {
      void importSheet((select as HTMLSelectElement).value).then(() => render());
    });
    section.append(el('label', { className: 'field' }, [el('span', { text: 'Sheet' }), select]));
  }

  if (state.data) {
    const source = state.data.shipment.source;
    section.append(
      el('div', { className: 'card' }, [
        el('div', {}, [el('strong', { text: source.fileName }), el('span', { className: 'muted', text: ` - sheet "${source.sheetName}"` })]),
        el('div', { className: 'small muted', text: `${source.rowCount} commodity line(s), imported ${new Date(source.importedAt).toLocaleString()}` }),
        el('div', { className: 'small', text: summarize(state.data.validation, source.rowCount) }),
      ]),
    );

    section.append(renderNotes(state.data.notes));

    const clearButton = el('button', { className: 'button button-danger', text: 'Clear Imported Data', attrs: { type: 'button' } });
    clearButton.addEventListener('click', () => void clearData());
    section.append(clearButton);
  }

  return section;
}

/**
 * Drag the workbook onto the panel instead of walking the file picker to it.
 *
 * A Chrome extension cannot watch the folder the companion writes into - that
 * would need a native messaging host, which is a much larger thing to install
 * and a much larger thing to trust. Dropping the file is the honest way to cut
 * the step down: the export window tells you where it wrote the file, and this
 * is one drag from there.
 *
 * The file is read exactly as a picked one is: same reader, same source
 * registry, nothing uploaded.
 */
function buildDropZone(): HTMLElement {
  const zone = el('div', { className: 'dropzone', attrs: { id: 'dropzone' } }, [
    el('span', { text: 'or drag ' }),
    el('code', { text: 'ACE_Invoice_<number>.xlsx' }),
    el('span', { text: ' here from the folder the export window named' }),
  ]);

  const stop = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  zone.addEventListener('dragover', (event) => {
    stop(event as DragEvent);
    zone.classList.add('dropzone-over');
  });
  zone.addEventListener('dragleave', (event) => {
    stop(event as DragEvent);
    zone.classList.remove('dropzone-over');
  });
  zone.addEventListener('drop', (event) => {
    stop(event as DragEvent);
    zone.classList.remove('dropzone-over');
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (!file) {
      setStatus('That drop carried no file.', 'warn');
      return;
    }
    void onFileChosen(file);
  });

  return zone;
}

function renderNotes(notes: MapperNote[]): HTMLElement {
  if (!notes.length) return el('div');
  const grouped = notes.slice(0, 60);
  return el('details', { className: 'card' }, [
    el('summary', { text: `Import notes (${notes.length})` }),
    el(
      'ul',
      { className: 'small note-list' },
      grouped.map((note) =>
        el('li', { className: `note note-${note.severity}` }, [
          note.sheetRow ? el('span', { className: 'note-row', text: `Row ${note.sheetRow}` }) : null,
          note.column ? el('span', { className: 'note-col', text: note.column }) : null,
          el('span', { text: note.message }),
        ]),
      ),
    ),
  ]);
}

function renderCell(cell: PreviewCell): HTMLElement {
  return el('div', { className: `cell cell-${cell.status}` }, [
    el('div', { className: 'cell-label' }, [dot(cell.status), el('span', { text: cell.label })]),
    el('div', { className: 'cell-value', text: cell.aceValue === '' ? '(empty)' : cell.aceValue }),
    cell.original
      ? el('div', { className: 'cell-original small muted', text: `original: ${cell.original}` })
      : null,
    cell.transform ? el('div', { className: 'cell-transform small', text: cell.transform }) : null,
    ...cell.messages.map((message) => el('div', { className: `cell-message small ${cell.status === 'red' ? 'error' : 'warn'}`, text: message })),
  ]);
}

function renderPreview(): HTMLElement {
  const section = el('section', { className: 'panel-section' });

  if (!state.data) {
    appendAll(
      section,
      el('h2', { text: 'Preview' }),
      el('p', { className: 'muted', text: 'Nothing imported yet.' }),
      state.surface === 'popup' ? buildOpenPanelButton('Open the panel to import a workbook') : null,
    );
    return section;
  }

  const preview = buildPreview(state.data.shipment, state.data.validation);

  section.append(
    el('h2', {}, [
      el('span', { text: 'Preview' }),
      el('span', { className: `pill pill-${preview.status}`, text: statusWord(preview.status) }),
    ]),
    el('p', { className: 'small muted', text: 'Review this before filling. ACE is only written when you click a Fill button.' }),
  );

  const invoiceCells = preview.invoiceCells.filter((cell) => cell.aceValue !== '' || cell.messages.length);
  section.append(
    el('details', { className: 'card', attrs: { open: 'open' } }, [
      el('summary', {}, [el('strong', { text: 'Shipment / invoice header' }), el('span', { className: 'muted small', text: ` (${invoiceCells.length} of ${preview.invoiceCells.length} populated)` })]),
      el('div', { className: 'cells' }, invoiceCells.map(renderCell)),
    ]),
  );

  for (const line of preview.commodities) {
    const isSelected = state.data.selectedLine === line.line;
    const header = el('summary', {}, [
      el('strong', { text: `Excel row -> ACE Commodity Line ${line.line}` }),
      el('span', { className: `pill pill-${line.status}`, text: statusWord(line.status) }),
      isSelected ? el('span', { className: 'pill pill-blue', text: 'selected' }) : null,
    ]);

    const selectButton = el('button', {
      className: 'button button-small',
      text: isSelected ? 'Selected for line fill' : 'Select this line',
      attrs: { type: 'button', ...(isSelected ? { disabled: 'disabled' } : {}) },
    });
    selectButton.addEventListener('click', () => void selectLine(line.line));

    section.append(
      el('details', { className: 'card', attrs: isSelected ? { open: 'open' } : {} }, [
        header,
        el('div', { className: 'cells' }, line.cells.map(renderCell)),
        selectButton,
      ]),
    );
  }

  return section;
}

function buildOpenPanelButton(label: string): HTMLElement {
  const button = el('button', { className: 'button', text: label, attrs: { type: 'button' } });
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
  });
  return button;
}

/** The ten named data quality checks, directly above the Fill buttons. */
function renderPreflight(result: PreflightResult): HTMLElement {
  const card = el('details', {
    className: `card preflight preflight-${result.ready ? 'ok' : 'bad'}`,
    attrs: result.ready ? {} : { open: 'open' },
  });

  card.append(
    el('summary', {}, [
      el('strong', { text: 'Data quality checks' }),
      el('span', {
        className: `pill pill-${result.blocking.length ? 'red' : result.warnings.length ? 'yellow' : 'green'}`,
        text: result.blocking.length
          ? `${result.blocking.length} blocking`
          : result.warnings.length
            ? `${result.warnings.length} to review`
            : 'all clear',
      }),
    ]),
  );

  card.append(el('p', { className: 'small muted', text: summarizePreflight(result) }));

  card.append(
    el(
      'ul',
      { className: 'check-list small' },
      result.checks.map((check) =>
        el('li', { className: `check check-${check.status}` }, [
          el('span', { className: 'check-mark', text: tick(check.status) }),
          el('span', { className: 'check-label', text: check.label }),
          el('span', { className: 'muted', text: check.detail }),
        ]),
      ),
    ),
  );

  if (result.blocking.length) {
    card.append(
      el('p', { className: 'small error', text: 'Fields with a blocking issue are skipped during a fill - never guessed, never partially written. Fix them in the source data and import again.' }),
    );
  }

  return card;
}

function renderFill(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Fill ACE' }));

  section.append(
    el('div', { className: 'notice' }, [
      el('strong', { text: 'You stay in control. ' }),
      el('span', { text: 'ACE Helper types values into the form you have open. It never saves a line, submits, or certifies a filing - review every field, then submit in ACE yourself.' }),
    ]),
  );

  if (!state.data) {
    section.append(el('p', { className: 'muted', text: 'Import a spreadsheet first.' }));
    if (state.surface === 'popup') section.append(buildOpenPanelButton('Open the panel to import'));
    return section;
  }

  const { shipment, validation, selectedLine } = state.data;

  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'small' }, [
        el('strong', { text: shipment.source.fileName }),
        el('span', { className: 'muted', text: ` - ${summarize(validation, shipment.commodities.length)}` }),
      ]),
      state.aceTab
        ? el('div', { className: 'small muted', text: `ACE tab: ${state.aceTab.title || state.aceTab.url}` })
        : el('div', { className: 'small error', text: 'No ACE tab detected. Open your ACE filing in another tab.' }),
    ]),
  );

  // The quality gate goes above the buttons on purpose: it is the last thing
  // read before the first thing clicked.
  const check = preflight();
  if (check) section.append(renderPreflight(check));

  // Commodity line picker
  const lineSelect = el('select', { className: 'select', attrs: { id: 'line-select' } });
  for (const commodity of shipment.commodities) {
    const label = `Line ${commodity.line} - ${commodity.scheduleB || 'no Schedule B'} - ${commodity.description || 'no description'}`;
    const option = el('option', { text: label, attrs: { value: String(commodity.line) } });
    if (commodity.line === selectedLine) option.setAttribute('selected', 'selected');
    lineSelect.append(option);
  }
  lineSelect.addEventListener('change', () => void selectLine(Number((lineSelect as HTMLSelectElement).value)));
  section.append(el('label', { className: 'field' }, [el('span', { text: 'Commodity line' }), lineSelect]));

  const overwrite = el('input', { attrs: { type: 'checkbox', id: 'overwrite' } });
  section.append(
    el('label', { className: 'checkbox' }, [
      overwrite,
      el('span', { text: 'Overwrite ACE fields that already have a different value' }),
    ]),
  );

  const pageReady = !!state.aceTab && !!state.page && state.page.page !== 'unknown';
  const onCommodities = state.page?.page === 'commodities';

  const fillPage = el('button', {
    className: 'button button-primary',
    text: 'Fill Current Page',
    attrs: { type: 'button', ...(pageReady ? {} : { disabled: 'disabled' }) },
  });
  fillPage.addEventListener('click', () => void fill('shipment', false));

  const fillLine = el('button', {
    className: 'button button-primary',
    text: 'Fill Current Commodity Line',
    attrs: { type: 'button', ...(pageReady && onCommodities ? {} : { disabled: 'disabled' }) },
  });
  fillLine.addEventListener('click', () => void fill('commodityLine', false));

  const dryRun = el('button', {
    className: 'button',
    text: 'Dry run (write nothing)',
    attrs: { type: 'button', ...(pageReady ? {} : { disabled: 'disabled' }) },
  });
  dryRun.addEventListener('click', () => void fill(onCommodities ? 'commodityLine' : 'shipment', true));

  section.append(el('div', { className: 'actions' }, [fillPage, fillLine, dryRun]));

  if (!pageReady) {
    section.append(
      el('p', { className: 'small warn', text: 'Fill is disabled until an ACE filing step is detected in the ACE tab. Use "refresh" in the header after navigating.' }),
    );
  } else if (!onCommodities) {
    section.append(
      el('p', { className: 'small muted', text: 'Commodity-line fill is available on the Commodities step once a line is open in the Line Details form (Edit on the Line Summary table, or Add New Line).' }),
    );
  }

  const clearHighlights = el('button', { className: 'button button-small', text: 'Clear ACE highlighting', attrs: { type: 'button' } });
  clearHighlights.addEventListener('click', () => {
    void (async () => {
      if (state.aceTab) await sendToTab(state.aceTab.id, { type: 'content/clearHighlights' });
    })();
  });
  section.append(clearHighlights);

  section.append(
    el('p', { className: 'small muted', text: 'Save Line, Add New Line, Submit and Certify are never clicked by this extension. See docs/SECURITY.md.' }),
  );

  if (state.report) section.append(renderReport(state.report));

  return section;
}

function renderReport(report: FillReport): HTMLElement {
  const card = el('div', { className: 'card' }, [
    el('div', { className: 'report-summary' }, [
      el('span', { className: 'pill pill-green', text: `Filled: ${report.filled}` }),
      el('span', { className: 'pill pill-grey', text: `Skipped: ${report.skipped}` }),
      el('span', { className: `pill pill-${report.warnings ? 'yellow' : 'grey'}`, text: `Warnings: ${report.warnings}` }),
      report.errors ? el('span', { className: 'pill pill-red', text: `Errors: ${report.errors}` }) : null,
    ]),
    el('div', { className: 'small muted', text: `${report.scope === 'commodityLine' ? `Commodity line ${report.line}` : 'Shipment-level fields'} on ${report.page}` }),
  ]);

  const list = el('ul', { className: 'outcome-list small' });

  for (const outcome of report.outcomes) {
    const tone =
      outcome.status === 'filled' ? 'green' : outcome.status === 'transformed' ? 'yellow' : outcome.status === 'error' ? 'red' : outcome.status === 'warning' ? 'yellow' : 'grey';

    const item = el('li', { className: `outcome outcome-${tone}` }, [
      el('span', { className: `dot dot-${tone === 'grey' ? 'yellow' : tone}` }),
      el('span', { className: 'outcome-label', text: outcome.label }),
      outcome.written !== undefined && outcome.written !== '' ? el('code', { text: outcome.written }) : null,
      outcome.transform ? el('span', { className: 'muted', text: ` (${outcome.transform})` }) : null,
      outcome.message ? el('div', { className: 'outcome-message', text: outcome.message }) : null,
    ]);

    if (outcome.status === 'warning' || outcome.status === 'error' || outcome.status === 'transformed') {
      const jump = el('button', { className: 'link-button', text: 'show field', attrs: { type: 'button' } });
      jump.addEventListener('click', () => void revealField(outcome.key));
      item.append(jump);
    }

    list.append(item);
  }

  card.append(list);
  return card;
}

/**
 * Mapping status: every ACE field, its source, what happened to the value, and
 * which ACE control it resolves to.
 */
function renderMapping(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Mapping status' }));

  if (!state.data) {
    section.append(el('p', { className: 'muted', text: 'Import a workbook to see the field mapping.' }));
    return section;
  }

  const summary = summarizeMappingStatus(state.mapping);
  section.append(
    el('p', { className: 'small' }, [
      el('span', { className: 'pill pill-green', text: `${summary.ready} ready` }),
      el('span', { className: 'pill pill-yellow', text: `${summary.review} to review` }),
      el('span', { className: `pill pill-${summary.blocked ? 'red' : 'grey'}`, text: `${summary.blocked} blocked` }),
    ]),
    el('p', {
      className: 'small muted',
      text: state.mappingChecked
        ? 'Selectors below were resolved against the ACE page you have open. Nothing was written.'
        : 'Selectors below are the configured candidates. Check against an open ACE page to see which one actually matches.',
    }),
  );

  const checkButton = el('button', {
    className: 'button',
    text: 'Check against the open ACE page (writes nothing)',
    attrs: { type: 'button' },
  });
  checkButton.addEventListener('click', () => void checkMappingAgainstPage());

  const copyButton = el('button', { className: 'button button-small', text: 'Copy as text', attrs: { type: 'button' } });
  copyButton.addEventListener('click', () => copyToClipboard(formatMappingStatus(state.mapping), 'Mapping status'));

  section.append(el('div', { className: 'actions' }, [checkButton, copyButton]));

  const pages: Array<[string, string]> = [
    ['shipment', 'Step 1: Shipment'],
    ['parties', 'Step 2: Parties'],
    ['commodities', 'Step 3: Commodities'],
    ['transportation', 'Step 4: Transportation'],
  ];

  for (const [page, label] of pages) {
    const rows = state.mapping.filter((row) => row.page === page);
    if (!rows.length) continue;

    const table = el('div', { className: 'map-table' });
    for (const row of rows) {
      table.append(
        el('div', { className: `map-row map-${row.status.toLowerCase().replace(/\s+/g, '-')}` }, [
          el('div', { className: 'map-head' }, [
            el('strong', { text: row.aceField }),
            el('span', { className: 'pill pill-grey', text: row.status }),
            row.line !== undefined ? el('span', { className: 'muted small', text: `line ${row.line}` }) : null,
          ]),
          el('dl', { className: 'map-fields small' }, [
            el('dt', { text: 'Source' }),
            el('dd', { text: row.source }),
            el('dt', { text: 'Original' }),
            el('dd', { text: row.original || '-' }),
            el('dt', { text: 'Transformation' }),
            el('dd', { text: row.transform ?? '(none)' }),
            el('dt', { text: 'ACE value' }),
            el('dd', { className: 'mono', text: row.aceValue || '-' }),
            el('dt', { text: 'ACE selector' }),
            el('dd', { className: 'mono', text: row.selector }),
          ]),
          row.message ? el('div', { className: 'small warn', text: row.message }) : null,
        ]),
      );
    }

    section.append(el('details', { className: 'card', attrs: { open: 'open' } }, [el('summary', { text: `${label} (${rows.length} fields)` }), table]));
  }

  return section;
}

function renderSettings(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Settings' }));

  const roundingMode = el('select', { className: 'select' });
  for (const [value, label] of [
    ['decimals', 'Round to N decimals'],
    ['integer', 'Round to whole numbers'],
    ['none', 'No rounding'],
  ] as const) {
    const option = el('option', { text: label, attrs: { value } });
    if (state.settings.rounding.mode === value) option.setAttribute('selected', 'selected');
    roundingMode.append(option);
  }
  roundingMode.addEventListener('change', () => {
    void persist({ rounding: { ...state.settings.rounding, mode: (roundingMode as HTMLSelectElement).value as AceHelperSettings['rounding']['mode'] } });
  });

  section.append(
    el('label', { className: 'field' }, [
      el('span', { text: 'Calculator rounding' }),
      roundingMode,
    ]),
    numberField('Calculator decimals', state.settings.rounding.decimals, 0, 6, (value) =>
      persist({ rounding: { ...state.settings.rounding, decimals: value } }),
    ),
    numberField('Shipping weight decimals', state.settings.weightDecimals, 0, 3, (value) => persist({ weightDecimals: value })),
    numberField('Value of goods decimals', state.settings.valueDecimals, 0, 4, (value) => persist({ valueDecimals: value })),
    numberField('Highlight duration (ms)', state.settings.highlightDurationMs, 0, 60000, (value) => persist({ highlightDurationMs: value })),
    checkboxField('Dispatch blur after writing (helps ACE fields that validate on blur)', state.settings.dispatchBlur, (value) =>
      persist({ dispatchBlur: value }),
    ),
    checkboxField('Treat unit-less weights as kilograms', state.settings.assumeWeightIsKg, (value) => persist({ assumeWeightIsKg: value })),
    checkboxField('Developer mode (verbose field detection + console logging)', state.settings.debugMode, (value) => persist({ debugMode: value })),
  );

  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Automation: ' }),
      el('span', {
        text: 'Save Line, Add New Line, Submit and Certify are disabled and there is no setting that enables them. See src/content/automationPolicy.ts.',
      }),
    ]),
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Privacy: ' }),
      el('span', {
        text: 'Settings are stored locally in this browser profile. Imported shipment data and the session log are held in session memory only, are never written to disk by this extension, and are dropped when the browser closes or you click Clear Imported Data.',
      }),
    ]),
  );

  return section;
}

function numberField(label: string, value: number, min: number, max: number, onChange: (value: number) => Promise<void>): HTMLElement {
  const input = el('input', { className: 'input', attrs: { type: 'number', value: String(value), min: String(min), max: String(max) } });
  input.addEventListener('change', () => {
    const parsed = Number((input as HTMLInputElement).value);
    if (Number.isFinite(parsed)) void onChange(Math.min(Math.max(parsed, min), max));
  });
  return el('label', { className: 'field' }, [el('span', { text: label }), input]);
}

function checkboxField(label: string, checked: boolean, onChange: (value: boolean) => Promise<void>): HTMLElement {
  const input = el('input', { attrs: { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) } });
  input.addEventListener('change', () => void onChange((input as HTMLInputElement).checked));
  return el('label', { className: 'checkbox' }, [input, el('span', { text: label })]);
}

async function persist(partial: Partial<AceHelperSettings>): Promise<void> {
  state.settings = await saveSettings(partial);
  rebuildMapping();
  render();
}

// ------------------------------------------------------------- diagnostics

/** Everything a support conversation needs, as one plain-text document. */
function buildDiagnosticsDocument(): string {
  const lines: string[] = [];
  lines.push('ACE Helper diagnostics');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('ACE filing: current browser session. This file was written on this machine and uploaded nowhere.');
  lines.push('');

  if (state.data) {
    const { shipment, validation, source } = state.data;
    lines.push(`Invoice        ${shipment.invoice.invoiceNumber || '(none)'}`);
    lines.push(`Customer       ${shipment.invoice.customerName || '(none)'}`);
    lines.push(`Workbook       ${shipment.source.fileName} (sheet "${shipment.source.sheetName}")`);
    if (source) lines.push(`Source         ${source.label} - ${source.detail}`);
    lines.push(`Lines          ${shipment.commodities.length}`);
    lines.push(`Validation     ${validation.errors} error(s), ${validation.warnings} warning(s)`);
  } else {
    lines.push('No workbook loaded.');
  }

  lines.push(`ACE tab        ${state.aceTab ? state.aceTab.url : '(none open)'}`);
  lines.push(`ACE page       ${state.page ? `${state.page.label} (${state.page.confidence})` : '(not detected)'}`);
  lines.push(
    `Selectors      ${Object.keys(state.overrides.fields).length} operator-captured, ${unverifiedFieldKeys().length} of ${ALL_MAPPINGS.length} built-in still unverified`,
  );
  lines.push('');

  if (state.mapping.length) {
    lines.push('Mapping status');
    lines.push(formatMappingStatus(state.mapping));
    lines.push('');
  }

  lines.push('Session log');
  lines.push(formatLog(state.log));
  lines.push('');

  if (state.diagnostics) {
    lines.push('Field detection snapshot (JSON)');
    lines.push(JSON.stringify(state.diagnostics, null, 2));
  }

  return lines.join('\n');
}

function renderSessionLog(): HTMLElement {
  const card = el('details', { className: 'card', attrs: { open: 'open' } });
  card.append(
    el('summary', {}, [
      el('strong', { text: 'Session log' }),
      el('span', { className: 'muted small', text: ` (${state.log.length} entries, memory only)` }),
    ]),
  );

  if (!state.log.length) {
    card.append(el('p', { className: 'muted small', text: 'Nothing recorded yet. Importing, transforming and filling all leave a line here.' }));
  } else {
    card.append(
      el(
        'ul',
        { className: 'log-list small mono' },
        state.log
          .slice()
          .reverse()
          .map((entry) =>
            el('li', { className: `log log-${entry.kind}` }, [
              el('span', { className: 'log-time', text: new Date(entry.at).toTimeString().slice(0, 8) }),
              el('span', { className: 'log-kind', text: entry.kind }),
              el('span', { text: entry.message }),
              entry.detail ? el('div', { className: 'log-detail muted', text: entry.detail }) : null,
            ]),
          ),
      ),
    );
  }

  const copy = el('button', { className: 'button button-small', text: 'Copy diagnostics', attrs: { type: 'button' } });
  copy.addEventListener('click', () => copyToClipboard(buildDiagnosticsDocument(), 'Diagnostics'));

  const exportButton = el('button', { className: 'button button-small', text: 'Export diagnostics', attrs: { type: 'button' } });
  exportButton.addEventListener('click', () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadText(buildDiagnosticsDocument(), `ace-helper-diagnostics-${stamp}.txt`);
  });

  const clearButton = el('button', { className: 'button button-small', text: 'Clear log', attrs: { type: 'button' } });
  clearButton.addEventListener('click', () => {
    void (async () => {
      await sendToBackground({ type: 'log/clear' });
      await refreshLog();
      setStatus('Session log cleared.', 'ok');
      render();
    })();
  });

  card.append(
    el('div', { className: 'actions' }, [copy, exportButton, clearButton]),
    el('p', { className: 'small muted', text: 'Nothing here is uploaded. Copy puts it on your clipboard; Export writes a file to this machine. Clearing the imported data clears this log with it, so export it first if you need the trail.' }),
  );

  return card;
}

/**
 * The selector table, and the editor that replaces it.
 *
 * This is the answer to "ACE changed and now nothing fills". A captured
 * selector pasted here takes effect on the next fill, with no rebuild and no
 * developer.
 */
function renderSelectorEditor(): HTMLElement {
  const card = el('details', { className: 'card' });
  const captured = Object.keys(state.overrides.fields);

  card.append(
    el('summary', {}, [
      el('strong', { text: 'ACE selectors' }),
      el('span', {
        className: `pill pill-${captured.length ? 'green' : 'yellow'}`,
        text: captured.length ? `${captured.length} captured` : `${unverifiedFieldKeys().length} unverified`,
      }),
    ]),
    el('p', { className: 'small muted', text: 'The selectors that ship with this build match Steps 1-3 by the label wording captured from the live portal; their ids are still guesses, and Step 4 is uncaptured. Capture the real elements with DevTools (docs/ACE-MAPPING.md) and paste them here: they are tried first, take effect on the next fill, and need no rebuild.' }),
  );

  const draft =
    state.overridesDraft ??
    (captured.length ? serializeOverrides(state.overrides) : serializeOverrides(starterOverrides(ALL_MAPPINGS, unresolvedFieldKeys())));

  const textarea = el('textarea', {
    className: 'input mono textarea',
    attrs: { rows: '12', spellcheck: 'false', id: 'overrides-input' },
  }) as HTMLTextAreaElement;
  textarea.value = draft;
  textarea.addEventListener('input', () => {
    state.overridesDraft = textarea.value;
  });

  card.append(el('label', { className: 'field' }, [el('span', { text: 'Selector overrides (JSON)' }), textarea]));

  const save = el('button', { className: 'button button-primary', text: 'Save selectors', attrs: { type: 'button' } });
  save.addEventListener('click', () => {
    void (async () => {
      try {
        state.overrides = await saveOverrides(textarea.value, document);
        state.overridesDraft = null;
        await appendLog('selectors', `Selector overrides saved: ${Object.keys(state.overrides.fields).length} field(s).`);
        await refreshLog();
        setStatus('Selectors saved. They take effect on the next fill; reload the ACE tab if it was already open.', 'ok');
      } catch (error) {
        setStatus((error as Error).message, 'error');
      }
      render();
    })();
  });

  const starter = el('button', { className: 'button button-small', text: 'Starter for unresolved fields', attrs: { type: 'button' } });
  starter.addEventListener('click', () => {
    state.overridesDraft = serializeOverrides(starterOverrides(ALL_MAPPINGS, unresolvedFieldKeys()));
    render();
  });

  const exportButton = el('button', { className: 'button button-small', text: 'Export', attrs: { type: 'button' } });
  exportButton.addEventListener('click', () => downloadText(serializeOverrides(state.overrides), 'ace-selectors.json'));

  const reset = el('button', { className: 'button button-small button-danger', text: 'Remove all', attrs: { type: 'button' } });
  reset.addEventListener('click', () => {
    void (async () => {
      await clearOverrides();
      state.overrides = emptyOverrides();
      state.overridesDraft = null;
      await appendLog('selectors', 'Selector overrides removed; the built-in candidates are in force again.');
      await refreshLog();
      setStatus('Selector overrides removed.', 'ok');
      render();
    })();
  });

  card.append(el('div', { className: 'actions' }, [save, starter, exportButton, reset]));

  if (state.diagnostics?.overrides.unknownKeys.length) {
    card.append(
      el('p', {
        className: 'small warn',
        text: `These override keys match no ACE field and are ignored: ${state.diagnostics.overrides.unknownKeys.join(', ')}.`,
      }),
    );
  }

  return card;
}

/** Field keys the last diagnostics run could not resolve on the ACE page. */
function unresolvedFieldKeys(): string[] {
  if (!state.diagnostics) return [];
  return state.diagnostics.fields.filter((field) => field.detection.status !== 'FOUND').map((field) => field.key);
}

function renderDiagnosticsTab(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Diagnostics' }));

  const run = el('button', { className: 'button', text: 'Run field detection on the ACE tab', attrs: { type: 'button' } });
  run.addEventListener('click', () => void runDiagnostics());
  section.append(el('div', { className: 'actions' }, [run]));

  section.append(renderSessionLog());
  section.append(renderSelectorEditor());

  const container = el('div', { className: 'diag-container' });
  renderDiagnostics(container, state.diagnostics);
  section.append(el('details', { className: 'card', attrs: state.diagnostics ? { open: 'open' } : {} }, [
    el('summary', { text: 'Field detection' }),
    container,
  ]));

  if (state.diagnostics) {
    const copy = el('button', { className: 'button button-small', text: 'Copy detection JSON', attrs: { type: 'button' } });
    copy.addEventListener('click', () => copyToClipboard(JSON.stringify(state.diagnostics, null, 2), 'Detection JSON'));
    section.append(copy);
  }

  return section;
}

function renderCalculator(): HTMLElement {
  return renderCalculatorPanel({
    settings: state.settings,
    onResult: (expression, result) => {
      if (!result.ok) return;
      void appendLog('calculator', `Panel calculator: ${expression} = ${result.insert}`);
    },
  });
}

// ------------------------------------------------------- deckhand + package

/** Keep the Deckhand extraction with the stored import, when there is one. */
async function persistDeckhand(next: DeckhandState | null): Promise<void> {
  state.deckhand = next;
  if (state.data) await storeData({ ...state.data, deckhand: next });
}

function renderDeckhand(): HTMLElement {
  return renderDeckhandTab({
    current: state.deckhand,
    draft: state.deckhandDraft,
    destination: 'ACE',
    onDraftChange: (text) => {
      state.deckhandDraft = text;
    },
    onExtracted: async (shipment) => {
      await persistDeckhand({ shipment, approvedAt: null });
      await appendLog('note', `Deckhand extracted ${shipment.containers.length} container(s) from ${shipment.source.name}.`);
      await refreshLog();
      render();
    },
    onApproved: async (approvedAt) => {
      if (!state.deckhand) return;
      await persistDeckhand({ shipment: state.deckhand.shipment, approvedAt });
      await appendLog('note', `Deckhand extraction approved (${state.deckhand.shipment.containers.length} container(s)).`);
      await refreshLog();
      render();
    },
    onCleared: async () => {
      await persistDeckhand(null);
      render();
    },
    setStatus,
    copyToClipboard,
    downloadText,
  });
}

function commercialSourceOfImport(): CommercialSource | null {
  const source = state.data?.source;
  if (!source) return null;
  if (source.id === 'filing-package') return state.data?.package?.commercialSource ?? null;
  if (source.id === 'excel' || source.id === 'quickbooks-export') return { id: source.id, label: source.label, detail: source.detail };
  return null;
}

async function buildPackage(): Promise<void> {
  if (!state.data) return;
  const invoice = state.data.package?.invoice ?? state.data.shipment;
  const pkg = buildFilingPackage({
    invoice,
    commercialSource: commercialSourceOfImport(),
    shipment: state.deckhand?.shipment ?? null,
    deckhandApproved: !!state.deckhand?.approvedAt,
    approvedAt: state.deckhand?.approvedAt ?? null,
    decisions: state.data.package?.decisions,
  });
  await storeData({ ...state.data, package: pkg });
  await appendLog('note', `Filing package ${pkg.packageId} built: ${pkg.containers.length} container(s), ${pkg.conflicts.length} conflict(s).`);
  await refreshLog();
  setStatus(`Filing package ${pkg.packageId} built. Save it as filing-package.json for the INTTRA Helper, or apply it to the ACE fields.`, pkg.conflicts.length ? 'warn' : 'ok');
  render();
}

/** Replace the ACE data with the package's view of it: booking, vessel, container and seal from the approved extraction. */
async function applyPackageToAce(pkg: FilingPackage): Promise<void> {
  if (!state.data) return;
  try {
    const view = aceShipmentFromPackage(pkg);
    const validation = validateShipment(view.shipment);
    await storeData({
      ...state.data,
      shipment: view.shipment,
      validation,
      notes: [...view.notes, ...state.data.notes.filter((note) => !note.message.startsWith('Package:'))],
      source: { id: 'filing-package', label: 'Filing package', detail: `${pkg.packageId} - applied to the ACE fields` },
      package: pkg,
    });
    state.report = null;
    await appendLog('note', `Filing package ${pkg.packageId} applied to the ACE fields.`);
    await refreshLog();
    setStatus('The ACE fields now read from the filing package. Check the preview, then fill.', view.notes.length ? 'warn' : 'ok');
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
  render();
}

function renderPackage(): HTMLElement {
  const pkg = state.data?.package ?? null;
  const buildable = !state.data
    ? { ok: false, reason: 'Import the ACE workbook (or a filing-package.json) first. ACE needs the invoice and its commodity lines; Deckhand adds the booking, containers and seals on top.' }
    : { ok: true, reason: '' };

  const apply = el('button', { className: 'button', text: 'Apply to the ACE fields', attrs: { type: 'button' } });
  apply.addEventListener('click', () => {
    if (pkg) void applyPackageToAce(pkg);
  });

  return renderPackageTab({
    pkg,
    buildable,
    destination: 'ACE',
    onBuild: buildPackage,
    onChange: async (next) => {
      if (!state.data) return;
      if (next.review.deckhand === 'approved' && state.deckhand && !state.deckhand.approvedAt) {
        state.deckhand = { shipment: state.deckhand.shipment, approvedAt: next.review.approvedAt };
      }
      await storeData({ ...state.data, package: next, deckhand: state.deckhand });
      render();
    },
    onClear: async () => {
      if (!state.data) return;
      await storeData({ ...state.data, package: null });
      setStatus('Filing package discarded. The imported data and the Deckhand extraction are still here.', 'ok');
      render();
    },
    setStatus,
    copyToClipboard,
    downloadText,
    actions: pkg ? [apply] : [],
  });
}

// -------------------------------------------------------------------- render

function render(): void {
  const root = byId('root');
  clear(root);

  root.append(renderHeader(), renderTabs());

  const statusBar = el('div', { className: 'status', attrs: { id: 'status' } });
  root.append(statusBar);

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
    case 'preview':
      root.append(renderPreview());
      break;
    case 'mapping':
      root.append(renderMapping());
      break;
    case 'calculator':
      root.append(renderCalculator());
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
    const open = buildOpenPanelButton('Open full panel (import, preview, mapping, diagnostics)');
    open.classList.add('button-small');
    root.append(el('footer', { className: 'app-footer' }, [open]));
  }

  renderStatus();
}

export async function startApp(surface: Surface, excelImporter: ExcelImporter | null = null): Promise<void> {
  state.surface = surface;
  importer = excelImporter;
  // With nothing loaded, the panel's first screen is the one thing there is to
  // do. This is where Phase 1 opened, and it stays there.
  state.activeTab = surface === 'panel' && importer ? 'import' : 'overview';

  render();

  state.settings = await loadSettings();
  state.counter = await loadCounter();
  state.overrides = await loadOverrides();
  await refreshData();
  await refreshLog();
  await refreshAceTab();

  // Something is already imported, so the hub is more use than the file picker.
  if (state.data) state.activeTab = 'overview';

  render();
}

/**
 * The Shipment Reference Number counter, on the overview.
 *
 * Deliberately not tucked into a settings screen. The filer's sequence may
 * have no gaps, which means a reserved number must be retired by hand once its
 * filing exists, and a number in flight that nobody can see is a number that
 * gets handed out twice. So it sits next to the fill buttons, saying what will
 * be written and what is waiting to be retired.
 *
 * It renders on BOTH overview states, loaded and empty. The counter is operator
 * state in `chrome.storage.local`, not shipment data, so it owes nothing to an
 * import; and the moment an operator wants it is the moment they install, with
 * nothing loaded at all.
 */
function referenceCounterBlock(): HTMLElement {
  const box = el('div', { className: 'panel-subsection' });
  const counter = state.counter;
  box.append(el('h2', { text: 'Shipment Reference Number' }));

  if (!counter.configured) {
    box.append(
      el('p', {
        className: 'small muted',
        text: 'Using the invoice number. Set a starting number to file your own running sequence instead.',
      }),
    );
    box.append(startingNumberForm('Set starting number'));
    return box;
  }

  const next = nextReference(counter);
  const held = counter.reserved !== null;
  box.append(
    el('p', {
      className: 'small',
      text: held
        ? `${formatReference(next)} is in use. It stays on every fill until you mark it filed, so an abandoned draft leaves no gap.`
        : `Next: ${formatReference(next)}. Last filed: ${counter.lastFiled || 'none yet'}.`,
    }),
  );

  const row = el('div', { className: 'actions' });
  if (held) {
    const filed = el('button', {
      className: 'button button-small',
      text: `Mark ${formatReference(next)} as filed`,
      attrs: { type: 'button', title: 'Advances the sequence. Do this once the filing exists in ACE.' },
    });
    filed.addEventListener('click', () => {
      void (async () => {
        state.counter = await saveCounter(markFiled(state.counter));
        setStatus(`Reference ${formatReference(next)} recorded as filed. Next is ${formatReference(nextReference(state.counter))}.`, 'ok');
        render();
      })();
    });
    row.append(filed);
  }
  row.append(startingNumberForm('Set next number'));
  box.append(row);
  return box;
}

/** Type where the sequence stands. Used to seed it, and to correct it. */
function startingNumberForm(label: string): HTMLElement {
  const wrap = el('div', { className: 'actions' });
  const input = el('input', {
    className: 'input input-small',
    attrs: { type: 'number', min: '1', step: '1', placeholder: '4088', 'aria-label': 'Next Shipment Reference Number' },
  }) as HTMLInputElement;
  const save = el('button', { className: 'button button-small', text: label, attrs: { type: 'button' } });
  save.addEventListener('click', () => {
    const wanted = Number(input.value);
    if (!Number.isFinite(wanted) || wanted < 1) {
      setStatus('Enter the next reference number you want ACE Helper to file, as a whole number.', 'warn');
      return;
    }
    void (async () => {
      state.counter = await saveCounter(setNextReference(state.counter, Math.floor(wanted)));
      setStatus(`Next Shipment Reference Number is ${formatReference(nextReference(state.counter))}.`, 'ok');
      render();
    })();
  });
  wrap.append(input, save);
  return wrap;
}
