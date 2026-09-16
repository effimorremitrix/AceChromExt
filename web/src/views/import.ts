/**
 * Import: the invoice, from a workbook or a package, read in this browser.
 */

import { el } from '../../../src/ui/dom.js';
import { buildPreview, summarize } from '../../../src/ui/preview.js';
import { buildPreflight } from '../../../src/ui/preflight.js';
import type { ShipmentRecord } from '../state.js';
import type { DashboardActions } from '../app.js';
import { loadSampleShipment } from '../workflow.js';

export function renderImport(record: ShipmentRecord, actions: DashboardActions): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Import' }),
    el('p', { className: 'small muted', text: 'Choose the ACE workbook (ACE_Invoice_<n>.xlsx from ace-export, or the template filled in by hand) or a filing-package.json from either extension or from ace-export package. The file is parsed here, in your browser; nothing is uploaded.' }),
  );

  const input = el('input', { className: 'file-input', attrs: { type: 'file', accept: '.xlsx,.xlsm,.xltx,.json', 'aria-label': 'Choose a workbook or a filing package' } }) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files?.length) void actions.importFiles(input.files).then(() => { input.value = ''; });
  });
  const drop = el('div', { className: 'dropzone', text: 'or drop the file here' });
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('dropzone-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dropzone-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('dropzone-over');
    if (event.dataTransfer?.files.length) void actions.importFiles(event.dataTransfer.files);
  });
  const sample = el('button', { className: 'button button-small', text: 'Load sample shipment', attrs: { type: 'button', title: 'Loads a bundled synthetic invoice and carrier email. Sample data, not a filing.' } });
  sample.addEventListener('click', () => actions.update(loadSampleShipment, 'Sample shipment loaded. This is sample data, not a filing.'));
  section.append(
    el('div', { className: 'card' }, [
      el('label', { className: 'field' }, [el('span', { text: 'Workbook (.xlsx) or filing package (.json)' }), input]),
      drop,
      el('div', { className: 'actions' }, [sample, el('span', { className: 'small muted', text: 'No file at hand? The sample is a synthetic invoice and booking email bundled with the page, marked as sample data. Never file it.' })]),
    ]),
  );

  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Where the invoice comes from. ' }),
      el('span', { text: 'QuickBooks Desktop stays on the Windows PC: run "node ace-export.mjs export <invoice>" (or "package <invoice> --deckhand <email.eml>") there and bring the file here. The dashboard never talks to QuickBooks, and QuickBooks never needs to be reachable from the Internet.' }),
    ]),
  );

  const commercial = record.commercial;
  if (!commercial) {
    section.append(el('p', { className: 'web-empty', text: 'Nothing imported for this shipment yet.' }));
    return section;
  }

  const preview = buildPreview(commercial.shipment, commercial.validation);
  const preflight = buildPreflight(commercial.shipment, commercial.validation, commercial.notes);
  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'invoice-number', text: commercial.shipment.invoice.invoiceNumber || '(no invoice number)' }),
      el('div', { text: commercial.shipment.invoice.customerName }),
      el('div', { className: 'small muted', text: `${commercial.source.label} - ${commercial.source.detail}` }),
      el('div', { className: 'small muted', text: `${commercial.fileName}: ${summarize(commercial.validation, commercial.shipment.commodities.length)}` }),
    ]),
  );

  const checks = el('ul', { className: 'check-list' });
  for (const check of preflight.checks) {
    checks.append(
      el('li', { className: `check check-${check.status}` }, [
        el('span', { className: 'check-mark', text: check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗' }),
        el('span', { className: 'check-label', text: check.label }),
        el('span', { className: 'small muted', text: check.detail }),
      ]),
    );
  }
  section.append(el('div', { className: `card${preflight.ready ? '' : ' preflight-bad'}` }, [el('strong', { text: 'Data quality checks (the ACE Helper runs these same checks)' }), checks]));

  if (commercial.notes.length) {
    section.append(
      el('details', { className: 'card', attrs: commercial.notes.some((note) => note.severity !== 'info') ? { open: 'open' } : {} }, [
        el('summary', { text: `Import notes (${commercial.notes.length})` }),
        el('ul', { className: 'small note-list' }, commercial.notes.map((note) => el('li', { className: `note note-${note.severity}` }, [
          note.sheetRow ? el('span', { className: 'note-row', text: `row ${note.sheetRow}` }) : null,
          note.column ? el('span', { className: 'note-col', text: note.column }) : null,
          el('span', { text: note.message }),
        ]))),
      ]),
    );
  }

  const cells = (list: typeof preview.invoiceCells): HTMLElement =>
    el('div', { className: 'cells' }, list.filter((cell) => cell.aceValue !== '' || cell.status !== 'green').map((cell) =>
      el('div', { className: `cell cell-${cell.status}` }, [
        el('div', { className: 'cell-label' }, [el('span', { className: `dot dot-${cell.status}` }), el('span', { text: cell.label })]),
        el('div', { className: 'cell-value', text: cell.aceValue || '(empty)' }),
        cell.original ? el('div', { className: 'cell-original small muted', text: `original: ${cell.original}` }) : null,
        cell.transform ? el('div', { className: 'cell-transform small', text: cell.transform }) : null,
        ...cell.messages.map((message) => el('div', { className: 'cell-message small muted', text: message })),
      ]),
    ));
  section.append(el('details', { className: 'card', attrs: { open: 'open' } }, [el('summary', { text: 'Shipment (invoice level)' }), cells(preview.invoiceCells)]));
  for (const line of preview.commodities) {
    section.append(el('details', { className: 'card' }, [el('summary', {}, [el('strong', { text: `Line ${line.line}` }), el('span', { className: `dot dot-${line.status}` })]), cells(line.cells)]));
  }
  return section;
}
