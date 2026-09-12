/**
 * Shared extension UI.
 *
 * Rendered into both surfaces:
 *   - popup  : quick actions against the ACE tab (fill, summary, line picker).
 *   - panel  : full page - Excel import, preview, diagnostics, settings.
 *
 * Import lives in the panel because Chrome closes an extension popup when a
 * file picker opens; the popup links to the panel instead.
 *
 * Safety invariants enforced here:
 *   - nothing is sent to ACE without an explicit button click;
 *   - no button in this UI saves, submits, or certifies an ACE filing.
 */

import type { FillReport } from '../models/AceField.js';
import type { DiagnosticsSnapshot, StoredImport } from '../core/messages.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AceHelperSettings } from '../core/settings.js';
import type { MapperNote } from '../excel/canonicalMapper.js';
import type { ExcelImporter, OpenedWorkbook } from './importer.js';
import { buildPreview, summarize, type PreviewCell } from './preview.js';
import { renderDiagnostics } from './diagnostics.js';
import { appendAll, byId, clear, el, show } from './dom.js';
import { resolveAceTab, sendToBackground, sendToTab, type AceTab } from './tabs.js';
import type { PageDetection } from '../content/pageDetector.js';

export type Surface = 'popup' | 'panel';

type StatusTone = 'info' | 'ok' | 'warn' | 'error';

interface AppState {
  surface: Surface;
  settings: AceHelperSettings;
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
}

/** Injected by the panel surface only; the popup has no Import tab. */
let importer: ExcelImporter | null = null;

const state: AppState = {
  surface: 'popup',
  settings: { ...DEFAULT_SETTINGS },
  data: null,
  workbook: null,
  aceTab: null,
  page: null,
  report: null,
  diagnostics: null,
  status: null,
  activeTab: 'fill',
  busy: false,
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

// ------------------------------------------------------------------ loading

async function refreshData(): Promise<void> {
  const response = await sendToBackground({ type: 'store/get' });
  state.data = response.ok && response.type === 'store/data' ? response.payload : null;
}

async function refreshAceTab(): Promise<void> {
  state.aceTab = await resolveAceTab();
  state.page = null;
  if (!state.aceTab) return;
  const response = await sendToTab(state.aceTab.id, { type: 'content/detectPage' });
  if (response.ok && response.type === 'content/page') state.page = response.payload;
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
  const firstSheet = opened.value.sheetNames[0] as string;
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
  const response = await sendToBackground({ type: 'store/set', payload });
  state.data = response.ok && response.type === 'store/data' ? response.payload : payload;
  state.report = null;
  state.activeTab = 'preview';
  setStatus(
    `Imported ${payload.shipment.commodities.length} line(s) from "${sheetName}" - ${summarize(payload.validation, payload.shipment.commodities.length)}. Nothing has been written to ACE yet.`,
    payload.validation.errors ? 'warn' : 'ok',
  );
}

async function clearData(): Promise<void> {
  await sendToBackground({ type: 'store/clear' });
  state.data = null;
  state.workbook = null;
  state.report = null;
  importer?.reset();
  if (state.aceTab) await sendToTab(state.aceTab.id, { type: 'content/clearHighlights' });
  setStatus('Imported data cleared from memory.', 'ok');
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

  const response = await sendToTab(state.aceTab.id, {
    type: 'content/fill',
    scope,
    ...(scope === 'commodityLine' ? { line: state.data.selectedLine } : {}),
    shipment: state.data.shipment,
    settings: state.settings,
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
  const { filled, skipped, warnings, errors } = response.payload;
  const prefix = dryRun ? 'Dry run (nothing written)' : 'Done';
  setStatus(
    `${prefix}: filled ${filled}, skipped ${skipped}, warnings ${warnings}${errors ? `, errors ${errors}` : ''}. Review every value in ACE before you submit.`,
    errors ? 'error' : warnings ? 'warn' : 'ok',
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

  return el('header', { className: 'app-header' }, [
    el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'ACE' }),
      el('span', { className: 'brand-name', text: 'Helper' }),
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
  const tabs: Array<{ id: string; label: string }> = [{ id: 'fill', label: 'Fill ACE' }];
  if (state.surface === 'panel') {
    tabs.unshift({ id: 'import', label: 'Import' });
    tabs.push({ id: 'preview', label: 'Preview' });
    tabs.push({ id: 'settings', label: 'Settings' });
    if (state.settings.debugMode) tabs.push({ id: 'diagnostics', label: 'Diagnostics' });
  } else {
    tabs.push({ id: 'preview', label: 'Preview' });
  }

  if (!tabs.some((tab) => tab.id === state.activeTab)) state.activeTab = tabs[0]?.id ?? 'fill';

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

function renderImport(): HTMLElement {
  const section = el('section', { className: 'panel-section' });

  if (!importer) {
    appendAll(
      section,
      el('h2', { text: 'Import Excel' }),
      el('p', { className: 'muted', text: 'Chrome closes an extension popup when a file picker opens, so importing happens in the panel.' }),
      buildOpenPanelButton('Open the panel to import'),
    );
    return section;
  }

  section.append(
    el('h2', { text: 'Import Excel' }),
    el('p', { className: 'muted small', text: 'The workbook is parsed in this browser. Nothing is uploaded anywhere.' }),
  );

  const fileInput = el('input', {
    className: 'file-input',
    attrs: { type: 'file', accept: '.xlsx,.xlsm,.xltx', id: 'file-input', ...(state.busy ? { disabled: 'disabled' } : {}) },
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void onFileChosen(file);
  });

  section.append(el('label', { className: 'field' }, [el('span', { text: 'Workbook (.xlsx)' }), fileInput]));

  const templateLink = el('a', {
    className: 'link',
    text: 'Download the import template',
    attrs: { href: chrome.runtime.getURL('templates/ACE_Import_Template.xlsx'), download: 'ACE_Import_Template.xlsx' },
  });
  section.append(el('p', { className: 'small' }, [templateLink]));

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
      el('p', { className: 'small muted', text: 'Commodity-line fill is available on the Commodities step, with the Line Details form open.' }),
    );
  }

  const clearHighlights = el('button', { className: 'button button-small', text: 'Clear ACE highlighting', attrs: { type: 'button' } });
  clearHighlights.addEventListener('click', () => {
    void (async () => {
      if (state.aceTab) await sendToTab(state.aceTab.id, { type: 'content/clearHighlights' });
    })();
  });
  section.append(clearHighlights);

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
    checkboxField('Developer mode (field diagnostics + console logging)', state.settings.debugMode, (value) => persist({ debugMode: value })),
  );

  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Privacy: ' }),
      el('span', {
        text: 'Settings are stored locally in this browser profile. Imported shipment data is held in session memory only, is never written to disk by this extension, and is dropped when the browser closes or you click Clear Imported Data.',
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
  render();
}

function renderDiagnosticsTab(): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(el('h2', { text: 'Diagnostics' }));

  const run = el('button', { className: 'button', text: 'Run field detection on the ACE tab', attrs: { type: 'button' } });
  run.addEventListener('click', () => void runDiagnostics());
  section.append(run);

  const container = el('div', { className: 'diag-container' });
  renderDiagnostics(container, state.diagnostics);
  section.append(container);

  if (state.diagnostics) {
    const copy = el('button', { className: 'button button-small', text: 'Copy diagnostics JSON', attrs: { type: 'button' } });
    copy.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(JSON.stringify(state.diagnostics, null, 2))
        .then(() => setStatus('Diagnostics JSON copied to the clipboard.', 'ok'))
        .catch(() => setStatus('Could not copy to the clipboard.', 'error'));
    });
    section.append(copy);
  }

  return section;
}

// -------------------------------------------------------------------- render

function render(): void {
  const root = byId('root');
  clear(root);

  root.append(renderHeader(), renderTabs());

  const statusBar = el('div', { className: 'status', attrs: { id: 'status' } });
  root.append(statusBar);

  switch (state.activeTab) {
    case 'import':
      root.append(renderImport());
      break;
    case 'preview':
      root.append(renderPreview());
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
    const open = buildOpenPanelButton('Open full panel (import, preview, settings)');
    open.classList.add('button-small');
    root.append(el('footer', { className: 'app-footer' }, [open]));
  }

  renderStatus();
}

export async function startApp(surface: Surface, excelImporter: ExcelImporter | null = null): Promise<void> {
  state.surface = surface;
  importer = excelImporter;
  state.activeTab = surface === 'panel' ? 'import' : 'fill';

  render();

  state.settings = await loadSettings();
  await refreshData();
  await refreshAceTab();

  if (state.data && surface === 'panel') state.activeTab = 'preview';

  render();
}
