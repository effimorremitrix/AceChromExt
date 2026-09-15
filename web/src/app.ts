/**
 * The operator dashboard: one shipment at a time, every value with its
 * source, and a clear list of what is left to do.
 *
 * Rendering follows the panels: plain DOM built with `el()`, re-rendered
 * from state after every change, no framework. The Deckhand and Package tabs
 * are the panels' own renderers, called with a context object, so the review
 * marks and the package rows are the ones the extensions show.
 *
 * The dashboard prepares; it never fills a portal. The last step of every
 * list here is "in Chrome, in the extension, and you submit".
 */

import { DEFAULT_SETTINGS, type AceHelperSettings } from '../../src/core/settings.js';
import { clear, el } from '../../src/ui/dom.js';
import { renderDeckhandTab } from '../../src/ui/deckhandTab.js';
import { renderPackageTab } from '../../src/ui/packageTab.js';
import { activeShipment, addShipment, emptyWorkspace, removeShipment, selectShipment, withShipment, type ShipmentRecord, type Workspace } from './state.js';
import {
  aceData,
  approveExtraction,
  attachExtraction,
  buildPackage,
  canBuild,
  discardExtraction,
  discardPackage,
  importFile,
  newShipment,
  packageFileName,
  packageText,
  renameShipment,
  replacePackage,
  setEmailDraft,
  shipmentLabel,
  WorkflowError,
} from './workflow.js';
import { aceReadiness, inttraReadiness, nextActions, provenanceRows, type DashboardTab } from './readiness.js';
import { copyText, downloadBytes, downloadText, readFileBytes } from './files.js';
import { buildDashboardWorkbook } from './exportExcel.js';
import { renderOverview } from './views/overview.js';
import { renderImport } from './views/import.js';
import { renderAce } from './views/ace.js';
import { renderInttra } from './views/inttra.js';
import { renderProvenance } from './views/provenance.js';

declare const __DASHBOARD_VERSION__: string;
declare const __DASHBOARD_BUILT_AT__: string;

const VERSION = typeof __DASHBOARD_VERSION__ === 'string' ? __DASHBOARD_VERSION__ : 'dev';
const BUILT_AT = typeof __DASHBOARD_BUILT_AT__ === 'string' ? __DASHBOARD_BUILT_AT__ : '';

export type StatusTone = 'info' | 'ok' | 'warn' | 'error';

export interface DashboardState {
  workspace: Workspace;
  tab: DashboardTab;
  status: { text: string; tone: StatusTone } | null;
  settings: AceHelperSettings;
  /** The commodity line the ACE tab describes. */
  aceLine: number | null;
  provenanceQuery: string;
}

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'import', label: 'Import' },
  { id: 'deckhand', label: 'Deckhand' },
  { id: 'package', label: 'Package' },
  { id: 'ace', label: 'ACE readiness' },
  { id: 'inttra', label: 'INTTRA readiness' },
  { id: 'provenance', label: 'Provenance' },
];

/** What a view may ask the app to do. */
export interface DashboardActions {
  state: DashboardState;
  record: ShipmentRecord | null;
  setStatus(text: string, tone: StatusTone): void;
  goTo(tab: DashboardTab): void;
  /** Apply a workflow step to the active shipment; errors become a status line. */
  update(step: (record: ShipmentRecord) => ShipmentRecord, okMessage?: string, tone?: StatusTone): void;
  importFiles(files: FileList | File[]): Promise<void>;
  downloadPackage(): void;
  /** The ACE workbook (.xlsx): the fallback hand-off for the ACE Helper. */
  downloadWorkbook(): void;
  copyToClipboard(text: string, what: string): void;
  downloadTextFile(text: string, fileName: string): void;
  setAceLine(line: number): void;
  setProvenanceQuery(query: string): void;
}

export function mountDashboard(root: HTMLElement, initial: Partial<DashboardState> = {}): DashboardActions {
  const state: DashboardState = {
    workspace: emptyWorkspace(),
    tab: 'overview',
    status: null,
    settings: DEFAULT_SETTINGS,
    aceLine: null,
    provenanceQuery: '',
    ...initial,
  };
  if (!state.workspace.shipments.length) state.workspace = addShipment(state.workspace, newShipment());

  const actions: DashboardActions = {
    state,
    get record(): ShipmentRecord | null {
      return activeShipment(state.workspace);
    },
    setStatus(text, tone) {
      state.status = { text, tone };
      render();
    },
    goTo(tab) {
      state.tab = tab;
      render();
    },
    update(step, okMessage, tone = 'ok') {
      const record = activeShipment(state.workspace);
      if (!record) return;
      try {
        const next = step(record);
        state.workspace = withShipment(state.workspace, next);
        const last = next.activity[next.activity.length - 1];
        state.status = { text: okMessage ?? last?.message ?? 'Done.', tone };
      } catch (error) {
        state.status = { text: error instanceof WorkflowError ? error.message : `Something went wrong: ${(error as Error).message}`, tone: 'error' };
      }
      render();
    },
    async importFiles(files) {
      for (const file of Array.from(files)) {
        let bytes: Uint8Array;
        try {
          bytes = await readFileBytes(file);
        } catch (error) {
          actions.setStatus(`Could not read ${file.name}: ${(error as Error).message}`, 'error');
          continue;
        }
        actions.update((record) => importFile(record, bytes, file.name, state.settings));
      }
    },
    downloadPackage() {
      const record = activeShipment(state.workspace);
      const text = record ? packageText(record) : null;
      if (!record || !text) {
        actions.setStatus('Build the filing package first.', 'warn');
        return;
      }
      try {
        downloadText(text, packageFileName(record));
        actions.setStatus(`Saved ${packageFileName(record)}. It was written to this machine only; import it into the ACE Helper or the INTTRA Helper.`, 'ok');
      } catch (error) {
        actions.setStatus(`Could not save the file: ${(error as Error).message}`, 'error');
      }
    },
    downloadWorkbook() {
      const record = activeShipment(state.workspace);
      const data = record ? aceData(record) : null;
      if (!record || !data) {
        actions.setStatus('The ACE workbook needs the invoice and its commodity lines. Import the workbook or a package that carries one first.', 'warn');
        return;
      }
      try {
        const workbook = buildDashboardWorkbook(data.view.shipment, data.validation, provenanceRows(record).rows, data.source.detail);
        downloadBytes(workbook.bytes, workbook.fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        actions.setStatus(`Saved ${workbook.fileName}. It was written to this machine only; import it into the ACE Helper.`, 'ok');
      } catch (error) {
        actions.setStatus(`Could not build the workbook: ${(error as Error).message}`, 'error');
      }
    },
    copyToClipboard(text, what) {
      void copyText(text).then((ok) => actions.setStatus(ok ? `${what} copied to the clipboard.` : 'Could not copy to the clipboard.', ok ? 'ok' : 'error'));
    },
    downloadTextFile(text, fileName) {
      try {
        downloadText(text, fileName);
        actions.setStatus(`Saved ${fileName}. It was written to this machine only.`, 'ok');
      } catch (error) {
        actions.setStatus(`Could not save the file: ${(error as Error).message}`, 'error');
      }
    },
    setAceLine(line) {
      state.aceLine = line;
      render();
    },
    setProvenanceQuery(query) {
      state.provenanceQuery = query;
      render();
    },
  };

  function renderHeader(): HTMLElement {
    const record = activeShipment(state.workspace);
    const select = el('select', { className: 'select', attrs: { 'aria-label': 'Open shipment' } }) as HTMLSelectElement;
    for (const item of state.workspace.shipments) {
      const option = el('option', { text: shipmentLabel(item), attrs: { value: item.id } }) as HTMLOptionElement;
      if (item.id === record?.id) option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', () => {
      state.workspace = selectShipment(state.workspace, select.value);
      state.aceLine = null;
      render();
    });

    const create = el('button', { className: 'button', text: 'New shipment', attrs: { type: 'button' } });
    create.addEventListener('click', () => {
      state.workspace = addShipment(state.workspace, newShipment());
      state.tab = 'import';
      state.aceLine = null;
      state.status = { text: 'New shipment. Import the invoice or open a filing-package.json.', tone: 'info' };
      render();
    });

    const open = el('input', { className: 'file-input', attrs: { type: 'file', accept: '.json,.xlsx,.xlsm,.xltx', hidden: 'hidden', 'aria-label': 'Open a filing package or workbook' } }) as HTMLInputElement;
    open.addEventListener('change', () => {
      if (open.files?.length) {
        state.workspace = addShipment(state.workspace, newShipment());
        void actions.importFiles(open.files).then(() => { open.value = ''; });
      }
    });
    const openButton = el('button', { className: 'button', text: 'Open file...', attrs: { type: 'button' } });
    openButton.addEventListener('click', () => open.click());

    return el('header', { className: 'app-header web-header' }, [
      el('div', { className: 'brand' }, [el('span', { className: 'brand-mark', text: 'ACE' }), el('span', { className: 'brand-name', text: 'Operator Dashboard' })]),
      el('div', { className: 'web-shipments' }, [select, create, openButton, open]),
      el('span', { className: 'web-local', text: 'Runs in this browser. Nothing is uploaded.' }),
    ]);
  }

  function renderTabs(): HTMLElement {
    const nav = el('nav', { className: 'tabs web-tabs', attrs: { 'aria-label': 'Dashboard sections' } });
    for (const tab of TABS) {
      const button = el('button', { className: `tab${state.tab === tab.id ? ' tab-active' : ''}`, text: tab.label, attrs: { type: 'button', 'data-tab': tab.id } });
      button.addEventListener('click', () => actions.goTo(tab.id));
      nav.append(button);
    }
    return nav;
  }

  function renderStatus(): HTMLElement {
    const status = el('div', { className: `status${state.status ? ` status-${state.status.tone}` : ''}`, attrs: { role: 'status', 'aria-live': 'polite' } });
    if (state.status) status.textContent = state.status.text;
    else status.hidden = true;
    return status;
  }

  function renderDeckhand(record: ShipmentRecord): HTMLElement {
    return renderDeckhandTab({
      current: record.extraction ? { shipment: record.extraction.shipment, approvedAt: record.extraction.approvedAt } : null,
      draft: record.emailDraft,
      onDraftChange: (text) => {
        state.workspace = withShipment(state.workspace, setEmailDraft(record, text));
      },
      // The shared tab runs the extractor itself (from the paste box or a file) and hands the result over.
      onExtracted: async (shipment) => actions.update((current) => attachExtraction(current, shipment), undefined, 'info'),
      onApproved: async () => actions.update((current) => approveExtraction(current)),
      onCleared: async () => actions.update((current) => discardExtraction(current), undefined, 'info'),
      setStatus: actions.setStatus,
      copyToClipboard: actions.copyToClipboard,
      downloadText: actions.downloadTextFile,
      destination: 'ACE and INTTRA',
    });
  }

  function renderPackage(record: ShipmentRecord): HTMLElement {
    const buildable = canBuild(record);
    const download = el('button', { className: 'button', text: 'Download ACE workbook (.xlsx)', attrs: { type: 'button' } });
    download.addEventListener('click', () => actions.downloadWorkbook());
    return renderPackageTab({
      pkg: record.pkg,
      buildable,
      destination: 'ACE and INTTRA',
      onBuild: async () => actions.update((current) => buildPackage(current)),
      onChange: async (pkg) => actions.update((current) => replacePackage(current, pkg, 'Package updated.'), 'Package updated.'),
      onClear: async () => actions.update((current) => discardPackage(current), undefined, 'info'),
      setStatus: actions.setStatus,
      copyToClipboard: actions.copyToClipboard,
      downloadText: actions.downloadTextFile,
      actions: record.pkg?.invoice ? [download] : [],
    });
  }

  function renderSection(): HTMLElement {
    const record = activeShipment(state.workspace);
    if (!record) return el('section', { className: 'panel-section' }, [el('p', { className: 'web-empty', text: 'Create a shipment to begin.' })]);
    switch (state.tab) {
      case 'import':
        return renderImport(record, actions);
      case 'deckhand':
        return renderDeckhand(record);
      case 'package':
        return renderPackage(record);
      case 'ace':
        return renderAce(record, actions, aceReadiness(record, state.settings, state.aceLine ?? undefined));
      case 'inttra':
        return renderInttra(record, actions, inttraReadiness(record));
      case 'provenance':
        return renderProvenance(record, actions, provenanceRows(record));
      case 'overview':
      default: {
        const ace = aceReadiness(record, state.settings);
        const inttra = inttraReadiness(record);
        return renderOverview(record, actions, { ace, inttra, steps: nextActions(record, ace, inttra), onRename: (name) => {
          state.workspace = withShipment(state.workspace, renameShipment(record, name));
          render();
        }, onRemove: () => {
          state.workspace = removeShipment(state.workspace, record.id);
          if (!state.workspace.shipments.length) state.workspace = addShipment(state.workspace, newShipment());
          state.status = { text: 'Shipment closed. It was held in memory only and is gone.', tone: 'info' };
          render();
        } });
      }
    }
  }

  function renderFooter(): HTMLElement {
    return el('footer', { className: 'app-footer web-footer' }, [
      el('span', { text: 'Local only: the invoice, the email and the package stay in this browser tab and are gone when it closes. Download the package to keep it.' }),
      el('span', { text: `Operator dashboard ${VERSION}${BUILT_AT ? `, built ${BUILT_AT}` : ''}. Fills nothing, submits nothing: the ACE Helper and the INTTRA Helper fill, and you submit.` }),
    ]);
  }

  // Removing a focused input fires blur, and blur can fire change, whose
  // handler asks for another render. A render requested during a render is
  // run once afterwards rather than nested inside the first.
  let rendering = false;
  let pending = false;
  function render(): void {
    if (rendering) {
      pending = true;
      return;
    }
    rendering = true;
    try {
      clear(root);
      root.append(renderHeader(), renderTabs(), renderStatus(), renderSection(), renderFooter());
    } finally {
      rendering = false;
    }
    if (pending) {
      pending = false;
      render();
    }
  }

  render();
  return actions;
}
